#!/usr/bin/env python3
"""JIT runner pool controller for the CI box (R20-8, #1024). Runs as `mahanfilms` from a user timer.

Why this shape: `generate-jitconfig` needs repo admin. That credential stays with `mahanfilms` (its
existing gh login); the `runner` user, which executes untrusted job code, only ever receives
single-use JIT configs through a spool directory (`/srv/data/ci-jit/spool/<slot>/`, group `ci-jit`,
created by `08_root_ci_pool.sh`). `jit_launcher.sh` (user `runner`) consumes one config, runs one
job (light: in a fresh container; docker: in a fresh runner directory), and GitHub removes the
runner when the job ends.

Each tick:
  1. kill switch `~/.config/roxira-jit/STOP` -> exit; lock so ticks never overlap;
  2. list the repo's runners; delete pool runners (`jit-<slot>-<epoch>-<hex>`) that are offline and
     older than `stale_after_s` (a config that was never started), and their spool files;
  3. per slot: when the slot has no registered pool runner (a minted config is registered at once,
     offline until the launcher starts it), and the launcher is alive and `~/.config/roxira-jit/HOLD` (load shedding) is absent, mint one JIT config;
  4. heartbeat: write the repo variable `CI_BOX_HEARTBEAT` = "<epoch> <light-ok> <docker-ok>" (read
     by scripts/ci/pick_runner.sh in auto mode), at most every `heartbeat_every_s` unless it changed.
     A slot is "ok" while its launcher is alive (heartbeat file < 120 s old) and not on HOLD; a busy
     slot stays ok, so jobs queue on the box instead of spending hosted minutes.
Never logs or prints a JIT config. Python stdlib only; GitHub through `gh api` (optional proxy).
"""
from __future__ import annotations

import argparse
import fcntl
import json
import logging
import os
import re
import secrets
import subprocess
import sys
import tempfile
import time
import tomllib
from pathlib import Path

log = logging.getLogger("jit_pool")

DEFAULTS = {
    "repo": "Mahan-film/roxira-platform",
    "dry_run": True,
    "proxy": "",
    "spool_dir": "/srv/data/ci-jit/spool",
    "state_dir": "~/.local/state/roxira-jit",
    "control_dir": "~/.config/roxira-jit",
    "runner_group_id": 1,
    "stale_after_s": 300,
    "launcher_alive_s": 120,
    "heartbeat_variable": "CI_BOX_HEARTBEAT",
    "heartbeat_every_s": 120,
    "slots": {
        "light": {"labels": ["self-hosted", "linux-box", "jit", "slot-light"]},
        "docker": {"labels": ["self-hosted", "linux-box", "jit", "slot-docker"]},
    },
}
SLOT_RE = re.compile(r"^[a-z]+$")
NAME_RE = re.compile(r"^jit-(?P<slot>[a-z]+)-(?P<ts>\d{10})-(?P<rand>[0-9a-f]{6})$")


class GhError(RuntimeError):
    pass


class GhApi:
    """Thin wrapper over `gh api`; same pattern as merge_gate.py. Raises GhError."""

    def __init__(self, proxy: str = ""):
        self.env = dict(os.environ)
        if proxy:
            for k in ("HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"):
                self.env[k] = proxy

    def __call__(self, method: str, path: str, fields: dict | None = None):
        cmd = ["gh", "api", "-X", method, path]
        for k, v in (fields or {}).items():
            if isinstance(v, list):
                for item in v:
                    cmd += ["-f", f"{k}[]={item}"]
            elif isinstance(v, int):
                cmd += ["-F", f"{k}={v}"]
            else:
                cmd += ["-f", f"{k}={v}"]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, env=self.env, timeout=90)
        except (OSError, subprocess.TimeoutExpired) as e:
            raise GhError(type(e).__name__) from e
        if r.returncode != 0:
            # gh errors never echo request bodies; still cap and strip anything config-like.
            raise GhError(redact((r.stderr or r.stdout).strip()[:300]))
        out = r.stdout.strip()
        return json.loads(out) if out else None


def redact(text: str) -> str:
    return re.sub(r"[A-Za-z0-9+/=_-]{40,}", "[redacted]", text)


def load_config(path: str | None) -> dict:
    cfg = json.loads(json.dumps(DEFAULTS))
    if path and Path(path).exists():
        with open(path, "rb") as fh:
            user = tomllib.load(fh)
        slots = user.pop("slots", None)
        cfg.update(user)
        if slots:
            cfg["slots"] = slots
    for slot, spec in cfg["slots"].items():
        if not SLOT_RE.match(slot):
            raise ValueError(f"bad slot name {slot!r}")
        labels = spec.get("labels") or []
        if "self-hosted" not in labels or "hp" in labels:
            # `hp` belongs to the old persistent runner; a JIT slot must never steal its jobs.
            raise ValueError(f"slot {slot}: labels must include self-hosted and not hp")
    return cfg


def parse_name(name: str) -> tuple[str, int] | None:
    m = NAME_RE.match(name or "")
    return (m.group("slot"), int(m.group("ts"))) if m else None


class Pool:
    def __init__(self, cfg: dict, api, now: float | None = None):
        self.cfg = cfg
        self.api = api
        self.now = int(now if now is not None else time.time())
        self.repo = cfg["repo"]
        self.spool = Path(cfg["spool_dir"])
        self.control = Path(os.path.expanduser(cfg["control_dir"]))
        self.state_path = Path(os.path.expanduser(cfg["state_dir"])) / "state.json"
        self.dry = bool(cfg["dry_run"])
        self.actions: list[str] = []

    # ---- spool -------------------------------------------------------------------------------
    def pending(self, slot: str) -> list[Path]:
        d = self.spool / slot
        return sorted(p for p in d.glob("jit-*.jit")) if d.is_dir() else []

    def launcher_alive(self, slot: str) -> bool:
        try:
            age = self.now - (self.spool / slot / ".alive").stat().st_mtime
        except OSError:
            return False
        return -60 <= age <= int(self.cfg["launcher_alive_s"])

    def write_spool(self, slot: str, name: str, encoded: str) -> None:
        d = self.spool / slot
        fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-")
        try:
            os.fchmod(fd, 0o640)
            with os.fdopen(fd, "w") as fh:
                fh.write(encoded)
            os.replace(tmp, d / f"{name}.jit")
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    # ---- state -------------------------------------------------------------------------------
    def load_state(self) -> dict:
        try:
            return json.loads(self.state_path.read_text())
        except (OSError, ValueError):
            return {}

    def save_state(self, data: dict) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.state_path.parent)
        with os.fdopen(fd, "w") as fh:
            json.dump(data, fh)
        os.replace(tmp, self.state_path)

    # ---- steps -------------------------------------------------------------------------------
    def runners(self) -> list[dict]:
        # One page of 100 is plenty for one repo; gh 2.46 on the box has no --slurp (see #1035).
        data = self.api("GET", f"repos/{self.repo}/actions/runners?per_page=100") or {}
        return list(data.get("runners") or []) if isinstance(data, dict) else list(data)

    def cleanup(self, runners: list[dict]) -> list[dict]:
        keep = []
        stale = int(self.cfg["stale_after_s"])
        for r in runners:
            parsed = parse_name(r.get("name", ""))
            if not parsed or parsed[0] not in self.cfg["slots"]:
                keep.append(r)
                continue
            slot, ts = parsed
            # never delete a busy runner: a network blip can show a runner offline mid-job
            if r.get("status") == "offline" and not r.get("busy") and self.now - ts > stale:
                self.actions.append(f"delete stale {r['name']}")
                if not self.dry:
                    try:
                        self.api("DELETE", f"repos/{self.repo}/actions/runners/{int(r['id'])}")
                    except GhError as e:
                        log.warning("delete %s failed: %s", r["name"], e)
                        keep.append(r)
                        continue
                    (self.spool / slot / f"{r['name']}.jit").unlink(missing_ok=True)
                continue
            keep.append(r)
        return keep

    def mint(self, slot: str) -> str:
        name = f"jit-{slot}-{self.now:010d}-{secrets.token_hex(3)}"
        self.actions.append(f"mint {name}")
        if self.dry:
            return name
        data = self.api("POST", f"repos/{self.repo}/actions/runners/generate-jitconfig", {
            "name": name,
            "runner_group_id": int(self.cfg["runner_group_id"]),
            "labels": list(self.cfg["slots"][slot]["labels"]),
            "work_folder": "_work",
        })
        encoded = (data or {}).get("encoded_jit_config")
        if not encoded:
            raise GhError("generate-jitconfig returned no config")
        self.write_spool(slot, name, encoded)
        return name

    def slot_status(self, runners: list[dict]) -> dict[str, dict]:
        held = (self.control / "HOLD").exists()
        out = {}
        for slot in self.cfg["slots"]:
            mine = [r for r in runners if (parse_name(r.get("name", "")) or ("",))[0] == slot]
            online = [r for r in mine if r.get("status") == "online"]
            out[slot] = {
                # registered pool runners (online, or offline but younger than stale_after_s:
                # a config waiting in the spool or a runner still starting)
                "present": len(mine),
                "online": len(online),
                "busy": sum(1 for r in online if r.get("busy")),
                "pending": len(self.pending(slot)),
                "alive": self.launcher_alive(slot),
                "held": held,
            }
        return out

    def heartbeat(self, status: dict[str, dict], state: dict) -> None:
        def ok(slot: str) -> int:
            s = status.get(slot) or {}
            return int(bool(s.get("alive")) and not s.get("held"))
        value = f"{self.now} {ok('light')} {ok('docker')}"
        last = state.get("heartbeat") or {}
        same = (last.get("value", "").split(" ")[1:] == value.split(" ")[1:])
        if same and self.now - int(last.get("at", 0)) < int(self.cfg["heartbeat_every_s"]):
            return
        var = self.cfg["heartbeat_variable"]
        self.actions.append(f"heartbeat {var}={value}")
        if not self.dry:
            try:
                self.api("PATCH", f"repos/{self.repo}/actions/variables/{var}", {"name": var, "value": value})
            except GhError as e:
                if "404" not in str(e) and "Not Found" not in str(e):
                    raise
                self.api("POST", f"repos/{self.repo}/actions/variables", {"name": var, "value": value})
        state["heartbeat"] = {"value": value, "at": self.now}

    def tick(self) -> dict:
        if (self.control / "STOP").exists():
            log.info("STOP present; doing nothing")
            return {"stopped": True}
        state = self.load_state()
        runners = self.cleanup(self.runners())
        status = self.slot_status(runners)
        for slot, s in status.items():
            if s["held"]:
                log.info("slot %s: HOLD (load shedding), not minting", slot)
            elif not s["alive"]:
                log.info("slot %s: launcher not alive, not minting", slot)
            elif s["present"] == 0:
                self.mint(slot)
                s["present"] += 1
                s["pending"] += 1
        self.heartbeat(status, state)
        if not self.dry:
            self.save_state(state)
        for a in self.actions:
            log.info("%s%s", "[dry-run] " if self.dry else "", a)
        return {"status": status, "actions": self.actions}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--config", default="~/.config/roxira-jit/jit_pool.toml")
    ap.add_argument("--dry-run", action="store_true", help="force dry-run whatever the config says")
    ap.add_argument("--status", action="store_true", help="print slot status (names and counts only)")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    cfg = load_config(os.path.expanduser(a.config))
    if a.dry_run or a.status:
        cfg["dry_run"] = True
    state_dir = Path(os.path.expanduser(cfg["state_dir"]))
    state_dir.mkdir(parents=True, exist_ok=True)
    with open(state_dir / "lock", "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log.info("another tick is running")
            return 0
        pool = Pool(cfg, GhApi(cfg.get("proxy", "")))
        try:
            result = pool.tick()
        except GhError as e:
            log.error("GitHub error: %s", e)
            return 1
    if a.status:
        for slot, s in (result.get("status") or {}).items():
            print(f"{slot}: registered={s['present']} online={s['online']} busy={s['busy']} pending={s['pending']} "
                  f"launcher={'alive' if s['alive'] else 'down'} hold={'yes' if s['held'] else 'no'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
