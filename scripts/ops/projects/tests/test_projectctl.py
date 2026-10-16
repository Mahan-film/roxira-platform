"""Offline tests for projectctl (no docker, no git, no network: runner/http are injected)."""

from __future__ import annotations

import json
import pathlib
import sys

import pytest

DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DIR))

import projectctl as pc  # noqa: E402

SHA1 = "a" * 40
SHA2 = "b" * 40

BASE = {
    "name": "demo", "repo": "https://github.com/o/demo.git", "domains": ["demo.example.com"],
    "health_url": "https://demo.example.com/health", "db_name": "demo", "enabled": True,
    "migrate_command": "npm run migrate",
}


def manifest(**over):
    d = dict(BASE)
    d.update(over)
    return pc.parse_manifest(d)


class FakeRunner:
    def __init__(self, remote_sha=SHA2, fail=()):
        self.calls, self.inputs = [], []
        self.remote_sha = remote_sha
        self.fail = fail  # substrings of joined argv that return rc=1
        self.db_exists = False

    def run(self, argv, cwd=None, input=None, timeout=None):
        line = " ".join(argv)
        self.calls.append(line)
        if input is not None:
            self.inputs.append(input)
        if any(f in line for f in self.fail):
            return pc.Result(1, "boom")
        if "rev-parse" in line:
            return pc.Result(0, self.remote_sha + "\n")
        if "pg_database" in (input or ""):
            return pc.Result(0, "1\n" if self.db_exists else "")
        return pc.Result(0, "")


def make_ctx(tmp_path, runner, statuses=(200,), tries=3):
    seq = list(statuses)

    def http(url, timeout=10):
        return seq.pop(0) if len(seq) > 1 else seq[0]

    ctx = pc.Ctx(runner=runner, http=http, sleep=lambda s: None, notify=lambda t: None,
                 now=lambda: "T", root=tmp_path / "srv", manifest_dir=tmp_path / "man",
                 state_dir=tmp_path / "state", lock_path=tmp_path / "lock",
                 health_tries=tries, health_interval=0)
    ctx.manifest_dir.mkdir(exist_ok=True)
    return ctx


def with_repo(ctx, m):
    (ctx.repo_dir(m) / ".git").mkdir(parents=True)


# ---- manifest ---------------------------------------------------------------------------
def test_example_manifest_is_valid():
    m = pc.load_manifest(DIR / "projects" / "example.yaml")
    assert m.name == "example" and m.enabled is False


@pytest.mark.parametrize("over", [
    {"name": "Bad_Name"}, {"repo": "ftp://x/y"}, {"repo": "-oProxy=evil"}, {"domains": []},
    {"domains": ["NOT A DOMAIN"]}, {"compose_file": "../x.yml"}, {"compose_file": "/etc/x.yml"},
    {"port": 0}, {"port": "80"}, {"health_url": "ftp://x"}, {"db_name": "postgres"},
    {"db_name": "a;drop"}, {"enabled": "yes"}, {"env_file": "relative/.env"},
    {"unknown_key": 1}, {"migrate_command": "a\nb"}, {"branch": "../x"},
])
def test_manifest_rejects_bad_values(over):
    with pytest.raises(pc.ManifestError):
        manifest(**over)


def test_manifest_defaults():
    m = manifest()
    assert (m.branch, m.service, m.port, m.compose_file) == ("main", "app", 3000, "docker-compose.yml")
    assert m.env_file == "/srv/projects/demo/.env"


def test_name_must_match_filename(tmp_path):
    p = tmp_path / "other.yaml"
    p.write_text("name: demo\nrepo: https://x.io/a.git\ndomains: [a.example.com]\n"
                 "health_url: http://a\ndb_name: demo\n")
    with pytest.raises(pc.ManifestError):
        pc.load_manifest(p)


def test_duplicate_domain_or_db_across_manifests(tmp_path):
    for n in ("one", "two"):
        (tmp_path / f"{n}.yaml").write_text(
            f"name: {n}\nrepo: https://x.io/a.git\ndomains: [same.example.com]\n"
            f"health_url: http://a\ndb_name: {n}\n")
    with pytest.raises(pc.ManifestError, match="domain"):
        pc.load_all(tmp_path)


# ---- caddyfile --------------------------------------------------------------------------
def test_caddyfile_rendering():
    a = manifest(domains=["a.example.com", "www.a.example.com"], port=8080)
    b = manifest(name="off", db_name="off", domains=["off.example.com"], enabled=False)
    text = pc.render_caddyfile([a, b])
    assert "a.example.com, www.a.example.com {" in text
    assert "reverse_proxy demo-app:8080" in text
    assert "off.example.com" not in text
    assert "http_port" not in text and "email" not in text


def test_caddyfile_custom_ports_and_email():
    text = pc.render_caddyfile([manifest()], http_port=8080, https_port=8443, email="o@example.com")
    assert "http_port 8080" in text and "https_port 8443" in text and "email o@example.com" in text


def test_render_proxy_idempotent(tmp_path, monkeypatch):
    monkeypatch.setenv("PROJECTS_PROXY_DIR", str(tmp_path / "proxy"))
    ctx = make_ctx(tmp_path, FakeRunner())
    assert pc.render_proxy(ctx, [manifest()]) is True
    assert pc.render_proxy(ctx, [manifest()]) is False


# ---- create -----------------------------------------------------------------------------
def test_create_writes_env_0600_and_never_leaks_password(tmp_path, capsys):
    env = tmp_path / "srv" / "demo" / ".env"
    m = manifest(env_file=str(env))
    r = FakeRunner()
    ctx = make_ctx(tmp_path, r)
    assert pc.create_project(ctx, m) == "created"
    assert oct(env.stat().st_mode & 0o777) == "0o600"
    pw = [ln for ln in env.read_text().splitlines() if ln.startswith("POSTGRES_PASSWORD=")][0].split("=", 1)[1]
    assert len(pw) >= 32
    assert not any(pw in c for c in r.calls)  # password only via stdin, never argv
    assert any("clone" in c for c in r.calls)
    assert pc.create_project(ctx, m) == "exists"  # second run keeps credentials
    assert env.read_text().count(pw) >= 2
    pc.main(["list"], ctx=ctx)
    assert pw not in capsys.readouterr().out


def test_create_failure_does_not_leak_password(tmp_path):
    m = manifest(env_file=str(tmp_path / "srv" / "demo" / ".env"))
    r = FakeRunner(fail=("psql",))
    ctx = make_ctx(tmp_path, r)
    with pytest.raises(RuntimeError) as e:
        pc.create_project(ctx, m)
    pw = r.inputs[0].split("PASSWORD '")[1].split("'")[0]
    assert pw not in str(e.value)
    assert not (tmp_path / "srv" / "demo" / ".env").exists()


# ---- deploy decisions -------------------------------------------------------------------
def test_deploy_skips_disabled_and_uncreated(tmp_path):
    ctx = make_ctx(tmp_path, FakeRunner())
    assert pc.deploy_project(ctx, manifest(enabled=False))["result"] == "disabled"
    assert pc.deploy_project(ctx, manifest())["result"] == "failed"


def test_deploy_up_to_date_does_nothing(tmp_path):
    m = manifest()
    r = FakeRunner(remote_sha=SHA1)
    ctx = make_ctx(tmp_path, r)
    with_repo(ctx, m)
    pc.write_state(ctx, m, {"deployed_sha": SHA1})
    assert pc.deploy_project(ctx, m)["result"] == "up-to-date"
    assert not any(" build" in c or " up " in c for c in r.calls)


def test_deploy_new_commit_full_flow(tmp_path):
    m = manifest()
    r = FakeRunner(remote_sha=SHA2)
    ctx = make_ctx(tmp_path, r)
    with_repo(ctx, m)
    pc.write_state(ctx, m, {"deployed_sha": SHA1})
    rec = pc.deploy_project(ctx, m)
    assert rec["result"] == "deployed" and rec["previous"] == SHA1[:12]
    order = [next(i for i, c in enumerate(r.calls) if k in c)
             for k in (" build", "pg_dump", " run --rm", " up -d")]
    assert order == sorted(order)  # build -> backup -> migrate -> up
    st = pc.read_state(ctx, m)
    assert st["deployed_sha"] == SHA2 and st["previous_sha"] == SHA1
    assert f"demo-app:{SHA2[:12]}" in ctx.override_file(m).read_text()


def test_failed_build_is_not_retried_until_new_commit(tmp_path):
    m = manifest()
    r = FakeRunner(remote_sha=SHA2, fail=(" build",))
    ctx = make_ctx(tmp_path, r)
    with_repo(ctx, m)
    pc.write_state(ctx, m, {"deployed_sha": SHA1})
    assert pc.deploy_project(ctx, m)["result"] == "failed"
    assert pc.deploy_project(ctx, m)["result"] == "skipped-failed"
    assert pc.deploy_project(ctx, m, force=True)["result"] == "failed"
    assert pc.read_state(ctx, m)["deployed_sha"] == SHA1


def test_failed_migration_never_switches(tmp_path):
    m = manifest()
    r = FakeRunner(fail=(" run --rm",))
    ctx = make_ctx(tmp_path, r)
    with_repo(ctx, m)
    pc.write_state(ctx, m, {"deployed_sha": SHA1})
    rec = pc.deploy_project(ctx, m)
    assert rec["result"] == "failed" and "migration" in rec["detail"]
    assert not any(" up -d" in c for c in r.calls)


# ---- rollback ---------------------------------------------------------------------------
def test_rollback_on_failed_health(tmp_path):
    m = manifest()
    r = FakeRunner(remote_sha=SHA2)
    # new version unhealthy (3 tries), previous healthy afterwards
    ctx = make_ctx(tmp_path, r, statuses=[500, 500, 500, 200], tries=3)
    with_repo(ctx, m)
    pc.write_state(ctx, m, {"deployed_sha": SHA1})
    rec = pc.deploy_project(ctx, m)
    assert rec["result"] == "rolled_back" and rec["sha"] == SHA2[:12]
    assert f"demo-app:{SHA1[:12]}" in ctx.override_file(m).read_text()
    assert any("up -d --no-build" in c for c in r.calls)
    st = pc.read_state(ctx, m)
    assert st["deployed_sha"] == SHA1 and st["failed_sha"] == SHA2


def test_failed_health_without_previous_image(tmp_path):
    m = manifest()
    ctx = make_ctx(tmp_path, FakeRunner(), statuses=[0], tries=2)
    with_repo(ctx, m)
    rec = pc.deploy_project(ctx, m)
    assert rec["result"] == "failed" and "no previous" in rec["detail"]


def test_manual_rollback(tmp_path):
    m = manifest()
    r = FakeRunner()
    ctx = make_ctx(tmp_path, r)
    with_repo(ctx, m)
    pc.write_state(ctx, m, {"deployed_sha": SHA2, "previous_sha": SHA1})
    rec = pc.rollback_project(ctx, m)
    assert rec["result"] == "rolled_back"
    st = pc.read_state(ctx, m)
    assert st["deployed_sha"] == SHA1 and st["previous_sha"] == SHA2


def test_manual_rollback_without_history(tmp_path):
    m = manifest()
    ctx = make_ctx(tmp_path, FakeRunner())
    with_repo(ctx, m)
    assert pc.rollback_project(ctx, m)["result"] == "failed"


# ---- lock -------------------------------------------------------------------------------
def test_lock_blocks_second_holder(tmp_path):
    with pc.Lock(tmp_path / "l"):
        with pytest.raises(pc.LockBusy):
            with pc.Lock(tmp_path / "l"):
                pass
    with pc.Lock(tmp_path / "l"):  # released after exit
        pass


def test_cli_deploy_busy_exit_code(tmp_path):
    ctx = make_ctx(tmp_path, FakeRunner())
    with pc.Lock(ctx.lock_path):
        assert pc.main(["deploy-all"], ctx=ctx) == 3


# ---- deploy-all -------------------------------------------------------------------------
def test_deploy_all_logs_and_notifies(tmp_path, monkeypatch):
    monkeypatch.setenv("PROJECTS_PROXY_DIR", str(tmp_path / "proxy"))
    sent = []
    r = FakeRunner(remote_sha=SHA2)
    ctx = make_ctx(tmp_path, r)
    ctx.notify = sent.append
    (ctx.manifest_dir / "demo.yaml").write_text(
        "name: demo\nrepo: https://x.io/a.git\ndomains: [demo.example.com]\n"
        "health_url: http://demo/h\ndb_name: demo\nenabled: true\n")
    (ctx.manifest_dir / "other.yaml").write_text(
        "name: other\nrepo: https://x.io/b.git\ndomains: [other.example.com]\n"
        "health_url: http://other/h\ndb_name: other\nenabled: false\n")
    with_repo(ctx, manifest())
    results = pc.deploy_all(ctx)
    assert [x["project"] for x in results] == ["demo"] and results[0]["result"] == "deployed"
    lines = (ctx.state_dir / "projects.jsonl").read_text().splitlines()
    assert json.loads(lines[0])["project"] == "demo"
    assert len(sent) == 1 and "deployed" in sent[0]
    assert "demo.example.com" in (tmp_path / "proxy" / "Caddyfile").read_text()
    # second run: nothing new -> no log line, no notification
    pc.deploy_all(ctx)
    assert len((ctx.state_dir / "projects.jsonl").read_text().splitlines()) == 1 and len(sent) == 1


def test_yaml_boolean_name_rejected():
    with pytest.raises(pc.ManifestError, match="boolean"):
        pc.parse_manifest({**BASE, "name": False})


def test_disable_edits_manifest(tmp_path):
    p = tmp_path / "x.yaml"
    p.write_text("name: x\nenabled: true\n")
    pc.set_enabled(p, False)
    assert "enabled: false" in p.read_text()
