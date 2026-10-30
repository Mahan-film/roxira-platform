#!/usr/bin/env python3
"""Upgrade the LiteLLM key-pool gateway safely. Run ON srv1 from the repo checkout.

  upgrade.py                    CANARY ONLY (default): render the fresh config, start the new image beside
                                the live one on a free loopback port, test it, print a PASS/FAIL table, remove
                                the canary. The live gateway on 127.0.0.1:4000 is never touched.
  upgrade.py --plan             no docker call that changes anything: only guards + what would run.
  upgrade.py --apply            canary first; only if every check passes, switch 127.0.0.1:4000 to the new image
                                (backup first, auto-rollback if the switched gateway fails its smoke test).
  upgrade.py --rollback         restore the newest backup (old config files + old image) and recreate the container.

Options: --image REF  (default: gateway.image in config/key_pool.yaml), --min-free-gb N, --env-file FILE.
Keys are read from the env file by NAME and passed only to the container (--env-file); no value is printed.
The old image is never removed here, so a rollback needs no network.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import keypool_config as kc  # noqa: E402
import render_litellm  # noqa: E402
import yaml  # noqa: E402

PROJECT = "roxira-keypool"
CONTAINER = "roxira_keypool"
CANARY = "roxira_keypool_canary"
NETWORK = "roxira_platform_roxira_net"
COMPOSE = HERE / "docker-compose.keypool.yml"
GEN = HERE / "generated"
BACKUPS = GEN / ".rollback"
LIVE_PORT = 4000
# Canary ports: loopback only, none of them in the AGENTS.md section 7 reservation list.
CANARY_PORTS = (14010, 14011, 14012, 14013, 14014)
CANARY_MEM = "1536m"
IMAGE_RE = re.compile(r"^ghcr\.io/berriai/litellm:v\d+\.\d+\.\d+(-stable)?$")
# Disk guard (bytes). Image pull of the new tag needs room; keep a floor free afterwards.
GB = 1024 ** 3
DEFAULT_MIN_FREE_GB = 5.5      # free space required BEFORE the pull
EXPECTED_PULL_GB = 3.0         # unverified estimate of the extra layers of the new image
FLOOR_AFTER_GB = 1.5           # must still be free after the estimated pull
MIN_MEM_AVAILABLE_MB = 700     # MemAvailable needed for old + canary side by side
EMBED_DIM = 1024               # BAAI/bge-m3


@dataclass
class Result:
    name: str
    status: str  # PASS | FAIL | SKIP
    detail: str = ""


class UpgradeError(RuntimeError):
    pass


# ---------------------------------------------------------------- pure helpers
def validate_image(ref: str) -> str:
    """Only a pinned stable release tag; never main-*/nightly/dev/rc/latest."""
    if not IMAGE_RE.match(ref):
        raise UpgradeError(f"image {ref!r} is not a pinned stable tag (ghcr.io/berriai/litellm:vX.Y.Z[-stable])")
    return ref


def parse_listening_ports(ss_output: str) -> set[int]:
    """Ports in LISTEN state from `ss -tln` (State Recv-Q Send-Q Local Peer)."""
    ports: set[int] = set()
    for line in ss_output.splitlines():
        cols = line.split()
        if len(cols) >= 4 and cols[0] == "LISTEN":
            tail = cols[3].rsplit(":", 1)[-1]
            if tail.isdigit():
                ports.add(int(tail))
    return ports


def pick_canary_port(used: set[int], candidates: tuple[int, ...] = CANARY_PORTS) -> int:
    for p in candidates:
        if p not in used:
            return p
    raise UpgradeError(f"no free canary port among {candidates}: check `ss -tlnp`")


def parse_meminfo(text: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for line in text.splitlines():
        m = re.match(r"(\w+):\s+(\d+)\s*kB", line)
        if m:
            out[m.group(1)] = int(m.group(2)) // 1024  # MB
    return out


def disk_guard(free_bytes: int, min_free_gb: float = DEFAULT_MIN_FREE_GB) -> Result:
    free_gb = free_bytes / GB
    if free_gb < min_free_gb:
        return Result("disk guard", "FAIL", f"{free_gb:.1f} GB free < {min_free_gb} GB required before the pull "
                      "(free space first, e.g. `docker image prune -f`; the old image is kept for rollback)")
    if free_gb - EXPECTED_PULL_GB < FLOOR_AFTER_GB:
        return Result("disk guard", "FAIL", f"{free_gb:.1f} GB free would leave < {FLOOR_AFTER_GB} GB after a "
                      f"~{EXPECTED_PULL_GB} GB pull")
    return Result("disk guard", "PASS", f"{free_gb:.1f} GB free (need {min_free_gb} before, {FLOOR_AFTER_GB} after)")


def mem_guard(meminfo: dict[str, int]) -> Result:
    avail = meminfo.get("MemAvailable", 0)
    swap_used = meminfo.get("SwapTotal", 0) - meminfo.get("SwapFree", 0)
    if avail < MIN_MEM_AVAILABLE_MB:
        return Result("memory guard", "FAIL", f"MemAvailable {avail} MB < {MIN_MEM_AVAILABLE_MB} MB for old + canary")
    return Result("memory guard", "PASS", f"MemAvailable {avail} MB, swap in use {swap_used} MB")


def canary_cmd(image: str, port: int, stage: pathlib.Path) -> list[str]:
    """docker run for the canary: loopback only, same hardening as the compose file, own log dir."""
    return [
        "docker", "run", "-d", "--name", CANARY, "--network", NETWORK,
        "--memory", CANARY_MEM, "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
        "--env-file", str(stage / "keypool.env"),
        "-e", "KEYPOOL_COST_LOG=/logs/requests.jsonl",
        "-v", f"{stage / 'litellm.config.yaml'}:/app/config.yaml:ro",
        "-v", f"{HERE / 'cost_logger.py'}:/app/cost_logger.py:ro",
        "-v", f"{stage / 'logs'}:/logs",
        "-p", f"127.0.0.1:{port}:4000",
        image, "--config", "/app/config.yaml", "--host", "0.0.0.0", "--port", "4000",
    ]


def chat_groups(model_names: set[str]) -> list[str]:
    """Free groups to try for the chat check (cheapest first); never a paid group."""
    pref = ["agent-light-free", "agent-strong-free", "product-free", "best-product-free"]
    return [g for g in pref if g in model_names]


def ladder_groups(pool: dict[str, Any]) -> list[str]:
    return [n for n, g in pool["groups"].items() if g.get("ordered")]


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0


# ---------------------------------------------------------------- IO (injectable)
def sh(args: list[str], timeout: int = 600, env: dict[str, str] | None = None) -> tuple[int, str]:
    full_env = dict(os.environ, **(env or {}))
    p = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=full_env)
    return p.returncode, (p.stdout + p.stderr).strip()


def http(method: str, url: str, key: str = "", body: dict | None = None, timeout: int = 60) -> tuple[int, Any]:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            status = r.status
    except urllib.error.HTTPError as e:
        raw, status = e.read(), e.code
    except OSError:
        return 0, None
    try:
        return status, json.loads(raw)
    except ValueError:
        return status, None


class Ctx:
    """Everything the steps touch, so tests can swap it."""

    def __init__(self, sh_fn: Callable = sh, http_fn: Callable = http, sleep: Callable = time.sleep,
                 free_bytes: Callable[[], int] | None = None, meminfo: Callable[[], dict[str, int]] | None = None,
                 out: Callable[[str], None] = print, gen: pathlib.Path = GEN):
        self.sh, self.http, self.sleep, self.out, self.gen = sh_fn, http_fn, sleep, out, gen
        self.free_bytes = free_bytes or self._free
        self.meminfo = meminfo or self._meminfo

    def _free(self) -> int:
        root = "/var/lib/docker" if os.path.isdir("/var/lib/docker") else "/"
        return shutil.disk_usage(root).free

    def _meminfo(self) -> dict[str, int]:
        try:
            return parse_meminfo(pathlib.Path("/proc/meminfo").read_text())
        except OSError:
            return {"MemAvailable": 10 ** 6}  # not Linux (dry local run): do not block


# ---------------------------------------------------------------- steps
def stage_files(pool: dict[str, Any], env_file: str, stage: pathlib.Path) -> tuple[dict[str, Any], str]:
    """Render the CURRENT config/key_pool.yaml into stage/ (this is what applies the stale #853 changes)."""
    got = kc.parse_env_names(env_file, kc.all_key_names(pool))
    master_env = pool["gateway"]["master_key_env"]
    if master_env not in got:
        raise UpgradeError(f"{master_env} missing in {env_file}: bash scripts/ops/set_server_env.sh {master_env} --generate")
    url_vars = {v for prov in pool["providers"].values() for v in prov.get("env_vars", [])}
    cfg = render_litellm.render(pool, set(got), values={n: v for n, v in got.items() if n in url_vars})
    stage.mkdir(parents=True, exist_ok=True)
    os.chmod(stage, 0o700)
    text = "# GENERATED by render_litellm.py from config/key_pool.yaml. Do not edit.\n" + yaml.safe_dump(cfg, sort_keys=False)
    (stage / "litellm.config.yaml").write_text(text, encoding="utf-8")
    envp = stage / "keypool.env"
    fd = os.open(envp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        for n, v in got.items():
            fh.write(f"{n}={v}\n")
    logs = stage / "logs"
    logs.mkdir(exist_ok=True)
    os.chmod(logs, 0o777)  # the container's user must be able to append requests.jsonl
    return cfg, got[master_env]


def wait_live(ctx: Ctx, port: int, tries: int = 60, delay: float = 3) -> bool:
    for _ in range(tries):
        status, _ = ctx.http("GET", f"http://127.0.0.1:{port}/health/liveliness", timeout=4)
        if status == 200:
            return True
        ctx.sleep(delay)
    return False


def check_models(ctx: Ctx, port: int, key: str, cfg: dict[str, Any]) -> Result:
    status, body = ctx.http("GET", f"http://127.0.0.1:{port}/v1/models", key)
    if status != 200 or not isinstance(body, dict):
        return Result("models list", "FAIL", f"GET /v1/models -> {status}")
    served = {m.get("id") for m in body.get("data", [])}
    want = {m["model_name"] for m in cfg["model_list"]}
    missing = sorted(want - served)
    return Result("models list", "FAIL" if missing else "PASS",
                  f"missing {len(missing)}: {', '.join(missing[:6])}" if missing else f"{len(want)} groups served")


def check_chat(ctx: Ctx, port: int, key: str, groups: list[str]) -> Result:
    if not groups:
        return Result("chat", "FAIL", "no free chat group rendered (no provider keys set?)")
    notes = []
    for g in groups:
        status, body = ctx.http("POST", f"http://127.0.0.1:{port}/v1/chat/completions", key,
                                {"model": g, "max_tokens": 8, "messages": [{"role": "user", "content": "Say ok."}]})
        if status == 200 and isinstance(body, dict) and body.get("choices"):
            return Result("chat", "PASS", f"{g} -> 200")
        notes.append(f"{g}:{status}")
    return Result("chat", "FAIL", "no group answered: " + ", ".join(notes))


def check_embeddings(ctx: Ctx, port: int, key: str) -> list[Result]:
    """The past blocker: a newer image broke /v1/embeddings to TEI. Test single, batch and both encodings."""
    url = f"http://127.0.0.1:{port}/v1/embeddings"
    out: list[Result] = []
    status, body = ctx.http("POST", url, key, {"model": "embeddings", "input": "سلام"})
    vec = _first_vec(body)
    ok = status == 200 and vec is not None and len(vec) == EMBED_DIM
    out.append(Result("embeddings single", "PASS" if ok else "FAIL",
                      f"200, dim {len(vec)}" if ok else f"status {status}, dim {len(vec) if vec else None}"))
    status, body = ctx.http("POST", url, key, {"model": "embeddings", "input": ["سلام", "hello"]})
    n = len(body.get("data", [])) if isinstance(body, dict) else 0
    out.append(Result("embeddings batch", "PASS" if status == 200 and n == 2 else "FAIL", f"status {status}, {n} vectors"))
    status, body = ctx.http("POST", url, key, {"model": "embeddings", "input": "x", "encoding_format": "float"})
    vec = _first_vec(body)
    out.append(Result("embeddings float", "PASS" if status == 200 and vec and len(vec) == EMBED_DIM else "FAIL",
                      f"status {status}"))
    return out


def _first_vec(body: Any) -> list[float] | None:
    try:
        v = body["data"][0]["embedding"]
        return v if isinstance(v, list) else None
    except (TypeError, KeyError, IndexError):
        return None


def check_parity(ctx: Ctx, canary_port: int, key: str) -> Result:
    """Same text through the live gateway and the canary must give (almost) the same vector."""
    body_in = {"model": "embeddings", "input": "قرارداد اجاره"}
    s1, b1 = ctx.http("POST", f"http://127.0.0.1:{LIVE_PORT}/v1/embeddings", key, body_in)
    s2, b2 = ctx.http("POST", f"http://127.0.0.1:{canary_port}/v1/embeddings", key, body_in)
    v1, v2 = _first_vec(b1), _first_vec(b2)
    if s1 != 200 or not v1:
        return Result("embeddings parity", "SKIP", f"live gateway gave {s1}; nothing to compare")
    if s2 != 200 or not v2:
        return Result("embeddings parity", "FAIL", f"canary gave {s2}")
    c = cosine(v1, v2)
    return Result("embeddings parity", "PASS" if c >= 0.999 else "FAIL", f"cosine {c:.5f} (need >= 0.999)")


def check_ladders(ctx: Ctx, port: int, key: str, pool: dict[str, Any], cfg: dict[str, Any]) -> Result:
    ladders = ladder_groups(pool)
    fb = {k for d in cfg["router_settings"].get("fallbacks", []) for k in d}
    missing = [g for g in ladders if g in {m["model_name"] for m in cfg["model_list"]} and g not in fb]
    if missing:
        return Result("ladders", "FAIL", f"ladder groups without fallbacks in config: {', '.join(missing)}")
    names = {m["model_name"] for m in cfg["model_list"]}
    free = [g for g in ladders if "free" in g and g in names]
    if not free:
        return Result("ladders", "SKIP", "no free ladder group rendered")
    for g in free:
        status, body = ctx.http("POST", f"http://127.0.0.1:{port}/v1/chat/completions", key,
                                {"model": g, "max_tokens": 8, "messages": [{"role": "user", "content": "Say ok."}]})
        if status == 200 and isinstance(body, dict) and body.get("choices"):
            return Result("ladders", "PASS", f"{len(ladders)} ladders configured; {g} -> 200")
    return Result("ladders", "FAIL", f"no free ladder answered ({', '.join(free)})")


def check_cost_log(ctx: Ctx, port: int, key: str, stage: pathlib.Path, groups: list[str]) -> Result:
    tag = f"canary-{int(time.time())}"
    secret = "CANARY-PROMPT-MUST-NOT-BE-LOGGED"
    for g in groups:
        status, _ = ctx.http("POST", f"http://127.0.0.1:{port}/v1/chat/completions", key,
                             {"model": g, "max_tokens": 8, "metadata": {"roxira_answer_id": tag, "roxira_feature": "canary"},
                              "messages": [{"role": "user", "content": secret}]})
        if status == 200:
            break
    else:
        return Result("cost logging", "FAIL", "no chat answered, nothing to log")
    path = stage / "logs" / "requests.jsonl"
    for _ in range(10):
        text = path.read_text(encoding="utf-8", errors="ignore") if path.exists() else ""
        for line in text.splitlines():
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if rec.get("answer_id") == tag:
                bad = [f for f in ("model_group", "prompt_tokens", "completion_tokens", "response_cost", "tier") if f not in rec]
                if secret in text:
                    return Result("cost logging", "FAIL", "prompt text leaked into the log")
                if bad:
                    return Result("cost logging", "FAIL", f"record lacks {bad}")
                if not rec.get("prompt_tokens"):
                    return Result("cost logging", "FAIL", "prompt_tokens is 0 (usage not captured)")
                return Result("cost logging", "PASS", f"{rec['model_group']} tier={rec['tier']} cost={rec['response_cost']}")
        ctx.sleep(1)
    return Result("cost logging", "FAIL", f"no record with answer_id {tag} in {path.name}")


def print_table(ctx: Ctx, results: list[Result]) -> bool:
    w = max(len(r.name) for r in results)
    ctx.out("")
    for r in results:
        ctx.out(f"  {r.status:<4}  {r.name:<{w}}  {r.detail}")
    ok = all(r.status != "FAIL" for r in results)
    ctx.out(f"\n  RESULT: {'PASS' if ok else 'FAIL'}")
    return ok


def run_canary(ctx: Ctx, image: str, pool: dict[str, Any], env_file: str, min_free_gb: float, plan: bool) -> tuple[list[Result], pathlib.Path | None]:
    """Guards, stage, start canary, run all checks, remove canary. Returns (results, stage dir or None)."""
    results = [disk_guard(ctx.free_bytes(), min_free_gb), mem_guard(ctx.meminfo())]
    rc, ss = ctx.sh(["ss", "-tln"])
    used = parse_listening_ports(ss) if rc == 0 else set()
    port = pick_canary_port(used)
    results.append(Result("canary port", "PASS", f"127.0.0.1:{port} (free, not reserved)"))
    if any(r.status == "FAIL" for r in results):
        return results, None
    stage = pathlib.Path(tempfile.mkdtemp(prefix="keypool-canary-"))  # 0700, outside the repo
    cfg, key = stage_files(pool, env_file, stage)
    results.append(Result("render fresh config", "PASS", f"{len(cfg['model_list'])} deployments from config/key_pool.yaml"))
    if plan:
        ctx.out(f"plan: docker pull {image}\nplan: {' '.join(canary_cmd(image, port, stage))}")
        shutil.rmtree(stage, ignore_errors=True)
        return results, None
    try:
        rc, o = ctx.sh(["docker", "pull", image], timeout=1800)
        results.append(Result("pull image", "PASS" if rc == 0 else "FAIL", image if rc == 0 else o[-200:]))
        if rc != 0:
            return results, stage
        left = ctx.free_bytes() / GB
        results.append(Result("disk after pull", "PASS" if left >= FLOOR_AFTER_GB else "FAIL", f"{left:.1f} GB free (floor {FLOOR_AFTER_GB})"))
        if left < FLOOR_AFTER_GB:
            return results, stage
        ctx.sh(["docker", "rm", "-f", CANARY])
        rc, o = ctx.sh(canary_cmd(image, port, stage))
        if rc != 0:
            results.append(Result("start canary", "FAIL", o[-200:]))
            return results, stage
        up = wait_live(ctx, port)
        results.append(Result("start canary", "PASS" if up else "FAIL", f"liveliness on :{port}" if up else "no liveliness in 180 s"))
        if not up:
            _, logs = ctx.sh(["docker", "logs", "--tail", "15", CANARY])
            results.append(Result("canary log tail", "FAIL", logs.replace("\n", " | ")[-400:]))
            return results, stage
        groups = chat_groups({m["model_name"] for m in cfg["model_list"]})
        results.append(check_models(ctx, port, key, cfg))
        results.append(check_chat(ctx, port, key, groups))
        results += check_embeddings(ctx, port, key)
        results.append(check_parity(ctx, port, key))
        results.append(check_ladders(ctx, port, key, pool, cfg))
        results.append(check_cost_log(ctx, port, key, stage, groups))
        _, mem = ctx.sh(["docker", "stats", "--no-stream", "--format", "{{.MemUsage}}", CANARY])
        results.append(Result("canary RAM", "PASS", mem or "n/a"))
    finally:
        ctx.sh(["docker", "rm", "-f", CANARY])
    return results, stage


# ---------------------------------------------------------------- switch / rollback
def live_image(ctx: Ctx) -> tuple[str, str]:
    rc, o = ctx.sh(["docker", "inspect", CONTAINER, "--format", "{{.Config.Image}} {{.Image}}"])
    if rc != 0 or " " not in o:
        raise UpgradeError(f"cannot inspect {CONTAINER}: {o[-200:]}")
    ref, img_id = o.split()[:2]
    return ref, img_id


def compose_up(ctx: Ctx, image: str) -> tuple[int, str]:
    return ctx.sh(["docker", "compose", "-f", str(COMPOSE), "-p", PROJECT, "up", "-d", "--force-recreate"],
                  timeout=300, env={"KEYPOOL_IMAGE": image})


def smoke_live(ctx: Ctx, key: str, groups: list[str]) -> Result:
    if not wait_live(ctx, LIVE_PORT, tries=40):
        return Result("live smoke", "FAIL", "no liveliness on :4000")
    chat = check_chat(ctx, LIVE_PORT, key, groups)
    emb = check_embeddings(ctx, LIVE_PORT, key)[0]
    bad = [r for r in (chat, emb) if r.status != "PASS"]
    return Result("live smoke", "FAIL" if bad else "PASS", "; ".join(f"{r.name}: {r.detail}" for r in bad) or "chat + embeddings ok")


def backup_live(ctx: Ctx) -> pathlib.Path:
    ref, img_id = live_image(ctx)
    d = ctx.gen / ".rollback" / time.strftime("%Y%m%d-%H%M%S")
    d.mkdir(parents=True, exist_ok=True)
    for f in ("litellm.config.yaml", "keypool.env"):
        if (ctx.gen / f).exists():
            shutil.copy2(ctx.gen / f, d / f)
    os.chmod(d, 0o700)
    (d / "image").write_text(f"{ref}\n{img_id}\n")
    (ctx.gen / ".rollback" / "LATEST").write_text(d.name)
    return d


def rollback(ctx: Ctx, key: str = "", groups: list[str] | None = None) -> Result:
    latest = ctx.gen / ".rollback" / "LATEST"
    if not latest.exists():
        raise UpgradeError(f"no backup under {ctx.gen / '.rollback'}")
    d = ctx.gen / ".rollback" / latest.read_text().strip()
    ref, img_id = (d / "image").read_text().split()[:2]
    for f in ("litellm.config.yaml", "keypool.env"):
        if (d / f).exists():
            shutil.copy2(d / f, ctx.gen / f)
    os.chmod(ctx.gen / "keypool.env", 0o600)
    rc, o = compose_up(ctx, img_id)  # by image ID: independent of what the old tag points to now
    if rc != 0:
        return Result("rollback", "FAIL", o[-300:])
    ok = wait_live(ctx, LIVE_PORT, tries=40)
    return Result("rollback", "PASS" if ok else "FAIL", f"restored {ref} ({img_id[:19]})" if ok else "gateway not live after rollback")


def apply_switch(ctx: Ctx, image: str, stage: pathlib.Path, key: str, groups: list[str]) -> list[Result]:
    res = [disk_guard(ctx.free_bytes(), 1.0)]  # canary pulled already; keep a floor for backup + logs
    if res[0].status == "FAIL":
        return res
    backup = backup_live(ctx)
    res.append(Result("backup", "PASS", str(backup)))
    ctx.gen.mkdir(parents=True, exist_ok=True)
    shutil.copy2(stage / "litellm.config.yaml", ctx.gen / "litellm.config.yaml")
    shutil.copy2(stage / "keypool.env", ctx.gen / "keypool.env")
    os.chmod(ctx.gen / "keypool.env", 0o600)
    rc, o = compose_up(ctx, image)
    res.append(Result("switch to new image", "PASS" if rc == 0 else "FAIL", image if rc == 0 else o[-300:]))
    smoke = smoke_live(ctx, key, groups) if rc == 0 else Result("live smoke", "FAIL", "compose failed")
    res.append(smoke)
    if smoke.status == "FAIL":
        res.append(rollback(ctx))
    return res


# ---------------------------------------------------------------- main
def main(argv: list[str] | None = None, ctx: Ctx | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--plan", action="store_true", help="guards and printed commands only, no docker change")
    mode.add_argument("--apply", action="store_true", help="canary, then switch :4000 if all checks pass")
    mode.add_argument("--rollback", action="store_true", help="restore the newest backup")
    ap.add_argument("--image")
    ap.add_argument("--env-file", default=os.environ.get("KEYPOOL_SRC_ENV", "/opt/roxira_platform/.env"))
    ap.add_argument("--min-free-gb", type=float, default=DEFAULT_MIN_FREE_GB)
    a = ap.parse_args(argv)
    ctx = ctx or Ctx()
    try:
        if a.rollback:
            r = rollback(ctx)
            return 0 if print_table(ctx, [r]) else 1
        pool = kc.load_pool()
        image = validate_image(a.image or pool["gateway"]["image"])
        if not pathlib.Path(a.env_file).is_file():
            raise UpgradeError(f"cannot read {a.env_file} (--env-file)")
        results, stage = run_canary(ctx, image, pool, a.env_file, a.min_free_gb, a.plan)
        ok = print_table(ctx, results)
        try:
            if ok and a.apply and stage is not None:
                cfg_names = {m["model_name"] for m in yaml.safe_load((stage / "litellm.config.yaml").read_text())["model_list"]}
                key = kc.parse_env_names(a.env_file, [pool["gateway"]["master_key_env"]])[pool["gateway"]["master_key_env"]]
                ok = print_table(ctx, apply_switch(ctx, image, stage, key, chat_groups(cfg_names)))
                if ok:
                    ctx.out("Switched. Rollback if needed: python3 scripts/infra/key_pool/upgrade.py --rollback")
            elif ok and not a.plan and not a.apply:
                ctx.out("Canary passed. Nothing was changed. Switch with: python3 scripts/infra/key_pool/upgrade.py --apply")
        finally:
            if stage is not None:
                shutil.rmtree(stage, ignore_errors=True)
        return 0 if ok else 1
    except (UpgradeError, kc.PoolError) as exc:
        ctx.out(f"upgrade: ERROR: {exc}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
