"""Offline tests for upgrade.py: fake docker + fake HTTP, no network, no real server."""
from __future__ import annotations

import json
import pathlib
import sys
from types import SimpleNamespace

import pytest

HERE = pathlib.Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))

import keypool_config as kc
import upgrade as up

GB = 1024 ** 3
KEY = "master-secret-value"
ENV_NAMES = ["GROQ_API_KEY", "SAMBANOVA_API_KEY", "MISTRAL_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "KEYPOOL_MASTER_KEY"]


def env_file(tmp_path, master=True):
    p = tmp_path / "env"
    names = ENV_NAMES if master else ENV_NAMES[:-1]
    p.write_text("\n".join(f"{n}=val-{n.lower()}" if n != "KEYPOOL_MASTER_KEY" else f"{n}={KEY}" for n in names) + "\n")
    return str(p)


class Fake:
    """Fake docker/ss + fake gateway HTTP. `live_ok` / `canary_ok` control the two gateways."""

    def __init__(self, tmp_path, canary_ok=True, live_ok=True, switched_ok=True, embed_dim=up.EMBED_DIM):
        self.calls: list[list[str]] = []
        self.canary_ok, self.live_ok, self.switched_ok, self.embed_dim = canary_ok, live_ok, switched_ok, embed_dim
        self.switched = False
        self.rolled_back = False
        self.tmp = tmp_path
        self.gen = tmp_path / "generated"
        self.gen.mkdir()
        (self.gen / "litellm.config.yaml").write_text("old: config\n")
        (self.gen / "keypool.env").write_text("OLD=1\n")
        import render_litellm
        self.cfg_names = {m["model_name"] for m in render_litellm.render(kc.load_pool(), set(ENV_NAMES))["model_list"]}
        self.ctx = up.Ctx(self.sh, self.http, lambda s: None, lambda: 20 * GB, lambda: {"MemAvailable": 2000, "SwapTotal": 1000, "SwapFree": 400},
                          lambda s: None, self.gen)

    def sh(self, args, timeout=600, env=None):
        self.calls.append(args)
        if args[:2] == ["ss", "-tln"]:
            return 0, "State Recv-Q Send-Q Local Peer\nLISTEN 0 4096 127.0.0.1:4000 0.0.0.0:*\nLISTEN 0 1 0.0.0.0:14010 0.0.0.0:*"
        if args[:2] == ["docker", "inspect"]:
            return 0, "ghcr.io/berriai/litellm:main-v1.77.7-stable sha256:oldimageid"
        if args[:3] == ["docker", "compose", "-f"]:
            if env and env["KEYPOOL_IMAGE"] == "sha256:oldimageid":
                self.rolled_back = True
            else:
                self.switched = True
            return 0, ""
        if args[:2] == ["docker", "run"]:
            self.canary_run = args
            return 0, "cid"
        return 0, "ok"

    def http(self, method, url, key="", body=None, timeout=60):
        port = int(url.split(":")[2].split("/")[0])
        path = url.split(str(port))[1]
        if port == up.LIVE_PORT:
            good = self.live_ok if not self.switched or self.rolled_back else self.switched_ok
        else:
            good = self.canary_ok
        if path == "/health/liveliness":
            return (200, {}) if good else (0, None)
        if not good:
            return 500, None
        assert key == KEY or path == "/health/liveliness"
        if path == "/v1/models":
            return 200, {"data": [{"id": n} for n in self.cfg_names]}
        if path == "/v1/embeddings":
            n = len(body["input"]) if isinstance(body["input"], list) else 1
            return 200, {"data": [{"embedding": [0.1] * self.embed_dim} for _ in range(n)]}
        if path == "/v1/chat/completions":
            if port != up.LIVE_PORT and body.get("metadata"):
                stage = next(pathlib.Path(a.split(":")[0]).parent for a in self.canary_run if a.endswith(":/logs"))
                rec = {"answer_id": body["metadata"]["roxira_answer_id"], "model_group": body["model"], "prompt_tokens": 5,
                       "completion_tokens": 2, "response_cost": 0.0, "tier": "free"}
                with open(stage / "logs" / "requests.jsonl", "a") as fh:
                    fh.write(json.dumps(rec) + "\n")
            return 200, {"choices": [{"message": {"content": "ok"}}]}
        return 404, None


@pytest.fixture
def fake(tmp_path):
    return Fake(tmp_path)


# ---- pure helpers
def test_config_image_is_pinned_stable():
    up.validate_image(kc.load_pool()["gateway"]["image"])


@pytest.mark.parametrize("bad", [
    "ghcr.io/berriai/litellm:main-v1.77.7-stable", "ghcr.io/berriai/litellm:latest", "ghcr.io/berriai/litellm:v1.105.1-nightly",
    "ghcr.io/berriai/litellm:v1.107.0rc1", "evil.io/berriai/litellm:v1.105.1", "ghcr.io/berriai/litellm"])
def test_validate_image_rejects(bad):
    with pytest.raises(up.UpgradeError):
        up.validate_image(bad)


def test_validate_image_accepts():
    assert up.validate_image("ghcr.io/berriai/litellm:v1.105.1")
    assert up.validate_image("ghcr.io/berriai/litellm:v1.105.6-stable")


def test_ports_never_reserved_and_skip_busy():
    reserved = {80, 443, 8000, 3000, 3001, 3002, 5432, 6432, 6379, 6333, 8888, 8005, 4000, 4001, 2053, 2096, 8443, 11111, 62789}
    assert not reserved & set(up.CANARY_PORTS)
    used = up.parse_listening_ports("LISTEN 0 1 127.0.0.1:4000 0.0.0.0:*\nLISTEN 0 1 [::]:14010 [::]:*\nESTAB 0 0 1.1.1.1:14011 2.2.2.2:1")
    assert used == {4000, 14010}
    assert up.pick_canary_port(used) == 14011
    with pytest.raises(up.UpgradeError):
        up.pick_canary_port(set(up.CANARY_PORTS))


def test_disk_guard():
    assert up.disk_guard(7.6 * GB).status == "PASS"  # srv1 today: allowed, but re-checked after the pull
    assert up.disk_guard(5 * GB).status == "FAIL"
    assert up.disk_guard(12 * GB).status == "PASS"
    assert up.disk_guard(7.6 * GB, min_free_gb=8).status == "FAIL"
    assert up.disk_guard(4.0 * GB, min_free_gb=3.0).status == "FAIL"  # floor after the pull


def test_mem_guard_and_meminfo():
    mi = up.parse_meminfo("MemAvailable:  512000 kB\nSwapTotal: 2048000 kB\nSwapFree: 1024000 kB\n")
    assert mi["MemAvailable"] == 500 and up.mem_guard(mi).status == "FAIL"
    assert up.mem_guard({"MemAvailable": 1500, "SwapTotal": 100, "SwapFree": 10}).status == "PASS"


def test_canary_cmd_is_loopback_and_hardened(tmp_path):
    cmd = up.canary_cmd("ghcr.io/berriai/litellm:v1.105.6", 14010, tmp_path)
    assert "127.0.0.1:14010:4000" in cmd and "4000:4000" not in " ".join(cmd).replace("14010:4000", "")
    assert "--cap-drop" in cmd and "no-new-privileges:true" in cmd and up.NETWORK in cmd and "--memory" in cmd
    assert not any("master" in c.lower() or KEY in c for c in cmd)


def test_cosine():
    assert up.cosine([1, 0], [1, 0]) == pytest.approx(1.0)
    assert up.cosine([1, 0], [0, 1]) == 0.0
    assert up.cosine([0, 0], [1, 1]) == 0.0


# ---- staging applies the CURRENT config (stale #853 changes)
def test_stage_renders_current_config_without_secrets(tmp_path):
    cfg, key = up.stage_files(kc.load_pool(), env_file(tmp_path), tmp_path / "stage")
    assert key == KEY
    text = (tmp_path / "stage" / "litellm.config.yaml").read_text()
    assert "val-" not in text and KEY not in text and "os.environ/" in text
    assert (tmp_path / "stage" / "keypool.env").stat().st_mode & 0o777 == 0o600
    assert any(m["model_name"] == "embeddings" for m in cfg["model_list"])


def test_stage_requires_master_key(tmp_path):
    with pytest.raises(up.UpgradeError):
        up.stage_files(kc.load_pool(), env_file(tmp_path, master=False), tmp_path / "stage")


# ---- end to end with fakes
def run(fake, tmp_path, *args):
    lines: list[str] = []
    fake.ctx.out = lines.append
    rc = up.main(["--env-file", env_file(tmp_path), *args], fake.ctx)
    return rc, "\n".join(lines)


def test_default_is_canary_only_and_never_switches(fake, tmp_path):
    rc, out = run(fake, tmp_path)
    assert rc == 0 and "RESULT: PASS" in out and "Nothing was changed" in out
    assert not fake.switched and (fake.gen / "litellm.config.yaml").read_text() == "old: config\n"
    assert ["docker", "rm", "-f", up.CANARY] in fake.calls  # canary always removed
    for name in ("chat", "embeddings single", "embeddings batch", "embeddings parity", "ladders", "cost logging", "models list"):
        assert any(line.split()[1:] and name in line and line.split()[0] == "PASS" for line in out.splitlines()), name


def test_plan_runs_no_docker_change(fake, tmp_path):
    rc, out = run(fake, tmp_path, "--plan")
    assert rc == 0 and "plan: docker pull" in out
    assert not any(c[:2] in (["docker", "pull"], ["docker", "run"]) for c in fake.calls)


def test_canary_failure_blocks_apply(tmp_path):
    f = Fake(tmp_path, canary_ok=False)
    rc, out = run(f, tmp_path, "--apply")
    assert rc == 1 and "FAIL" in out and not f.switched
    assert (f.gen / "litellm.config.yaml").read_text() == "old: config\n"


def test_broken_embeddings_fail_the_table(tmp_path):
    f = Fake(tmp_path, embed_dim=3)
    rc, out = run(f, tmp_path, "--apply")
    assert rc == 1 and not f.switched and "embeddings single" in out


def test_disk_guard_blocks_before_pull(tmp_path):
    f = Fake(tmp_path)
    f.ctx.free_bytes = lambda: int(4.5 * GB)
    rc, out = run(f, tmp_path, "--apply")
    assert rc == 1 and "disk guard" in out
    assert not any(c[:2] == ["docker", "pull"] for c in f.calls)


def test_disk_floor_rechecked_after_pull(tmp_path):
    f = Fake(tmp_path)
    free = iter([int(7.6 * GB), int(0.8 * GB)])
    f.ctx.free_bytes = lambda: next(free, int(0.8 * GB))
    rc, out = run(f, tmp_path, "--apply")
    assert rc == 1 and "disk after pull" in out and not f.switched
    assert not any(c[:2] == ["docker", "run"] for c in f.calls)


def test_apply_switches_with_backup(fake, tmp_path):
    rc, out = run(fake, tmp_path, "--apply")
    assert rc == 0 and fake.switched and not fake.rolled_back and "Rollback if needed" in out
    backup = fake.gen / ".rollback" / (fake.gen / ".rollback" / "LATEST").read_text()
    assert (backup / "litellm.config.yaml").read_text() == "old: config\n"
    assert (backup / "image").read_text().split() == ["ghcr.io/berriai/litellm:main-v1.77.7-stable", "sha256:oldimageid"]
    assert "old: config" not in (fake.gen / "litellm.config.yaml").read_text()
    assert (fake.gen / "keypool.env").stat().st_mode & 0o777 == 0o600


def test_failed_smoke_after_switch_rolls_back_automatically(tmp_path):
    f = Fake(tmp_path, switched_ok=False)
    rc, out = run(f, tmp_path, "--apply")
    assert rc == 1 and f.switched and f.rolled_back
    assert (f.gen / "litellm.config.yaml").read_text() == "old: config\n"
    assert (f.gen / "keypool.env").read_text() == "OLD=1\n"


def test_manual_rollback(fake, tmp_path):
    run(fake, tmp_path, "--apply")
    fake.rolled_back = False
    rc, out = run(fake, tmp_path, "--rollback")
    assert rc == 0 and fake.rolled_back and "sha256:oldimagei" in out
    assert (fake.gen / "litellm.config.yaml").read_text() == "old: config\n"


def test_rollback_without_backup(tmp_path):
    f = Fake(tmp_path)
    rc, out = run(f, tmp_path, "--rollback")
    assert rc == 2 and "no backup" in out


def test_cost_log_tries_again_when_a_free_provider_reports_no_usage(tmp_path):
    log = tmp_path / "logs" / "requests.jsonl"
    log.parent.mkdir()
    calls = []

    def http(_method, _url, _key, body):
        calls.append(body)
        rec = {"answer_id": body["metadata"]["roxira_answer_id"], "model_group": "g", "prompt_tokens": len(calls) - 1,
               "completion_tokens": 1, "response_cost": 0.0, "tier": "free"}
        with log.open("a") as f:
            f.write(json.dumps(rec) + "\n")
        return 200, {}

    ctx = SimpleNamespace(http=http, sleep=lambda _s: None)
    result = up.check_cost_log(ctx, 1, "k", tmp_path, ["g"])
    assert result.status == "PASS" and len(calls) == 2
