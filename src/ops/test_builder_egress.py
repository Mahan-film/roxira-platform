"""Builder egress pack (R20-6, #1022): redaction filter, allowlist generator, PreToolUse guard, gh wrapper.

Secret-shaped test values are assembled at run time so no scanner sees a key literal in the repo.
"""
import importlib.util
import os
import stat
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / "scripts/ops/ci_box/builder_egress"


def _load(name: str):
    sys.path.insert(0, str(PACK))
    spec = importlib.util.spec_from_file_location(name, PACK / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def redact_mod():
    return _load("redact")


@pytest.fixture(scope="module")
def gen():
    return _load("gen_egress")


@pytest.fixture(scope="module")
def guard():
    _load("redact")
    return _load("pretool_guard")


@pytest.fixture(scope="module")
def ghr():
    _load("redact")
    return _load("gh_redact")


A = "a1B2c3D4" * 5  # 40 chars of key-like body


@pytest.mark.parametrize("secret", [
    "sk-ant-" + A,
    "sk-or-v1-" + A,
    "sk-proj-" + A,
    "ghp_" + A,
    "github_pat_" + A,
    "glpat-" + A[:20],
    "AIza" + A[:35],
    "gsk_" + A[:30],
    "hf_" + A[:34],
    "xoxb-" + "1234567890-" + A[:20],
    "AKIA" + "ABCDEFGHIJKLMNOP",
    "123456789:" + A[:35],
    "eyJ" + A[:12] + "." + A[:12] + "." + A[:12],
])
def test_key_shapes_are_redacted(redact_mod, secret):
    out = redact_mod.redact(f"token was {secret} ok")
    assert secret not in out
    assert "[REDACTED:" in out


def test_assignments_and_bearer(redact_mod):
    out = redact_mod.redact("KEYPOOL_MASTER_KEY=" + A + "\nAuthorization: Bearer " + A)
    assert A not in out
    assert "KEYPOOL_MASTER_KEY=[REDACTED:secret]" in out


def test_pem_and_url_credentials(redact_mod):
    pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nabcdef\n-----END OPENSSH PRIVATE KEY-----"
    assert "abcdef" not in redact_mod.redact("x\n" + pem + "\ny")
    out = redact_mod.redact("git clone https://user:" + A[:12] + "@github.com/a/b")
    assert A[:12] not in out and "github.com/a/b" in out


def test_ips(redact_mod):
    out = redact_mod.redact("host 203.0.113.7 and 10.1.2.3, proxy 127.0.0.1:10809, v6 2001:db8::1 and ::1")
    assert "203.0.113.7" not in out and "10.1.2.3" not in out and "2001:db8::1" not in out
    assert "127.0.0.1:10809" in out and "::1" in out
    assert redact_mod.redact("999.1.1.1") == "999.1.1.1"  # not an address
    assert redact_mod.redact("12:30:45 time") == "12:30:45 time"


def test_email_and_phone(redact_mod):
    out = redact_mod.redact("mail someone@example.org, call +49 151 2345 6789 or 09121234567 or 0049 1512345678")
    for leaked in ("someone@example.org", "151 2345 6789", "09121234567", "1512345678"):
        assert leaked not in out
    assert out.count("[REDACTED:phone]") == 3


def test_plain_text_and_numbers_survive(redact_mod):
    text = "PR #1089 fixed 3 files in 12.5s, commit 740de08f3, port 4181, sha 2026-11-21"
    assert redact_mod.redact(text) == text


def test_personal_names_from_external_file(redact_mod, tmp_path, monkeypatch):
    names = tmp_path / "names.txt"
    names.write_text("# comment\nJane Example\nex\n")  # "ex" is too short to be used
    monkeypatch.setenv("REDACT_NAMES_FILE", str(names))
    out = redact_mod.redact("Thanks jane example, see the index")
    assert "jane example" not in out.lower() and "index" in out
    monkeypatch.delenv("REDACT_NAMES_FILE")
    assert "jane example" in redact_mod.redact("Thanks jane example")


def test_findings_never_return_values(redact_mod):
    kinds = redact_mod.findings("a@b.org 203.0.113.7 " + "sk-ant-" + A)
    assert kinds == ["email", "ip", "key"]
    assert redact_mod.findings("nothing here") == []


def test_idempotent(redact_mod):
    once = redact_mod.redact("sk-ant-" + A + " 203.0.113.7 a@b.org")
    assert redact_mod.redact(once) == once


# ---- allowlist generator ----

def test_shipped_allowlist_renders(gen):
    files = gen.render_all((PACK / "allowlist.txt").read_text(), "roxira-builder", 10810,
                           ("127.0.0.1", 10809), "/etc/tinyproxy/f")
    nft = files["roxira_builder.nft"]
    assert 'meta skuid "roxira-builder" jump builder' in nft
    assert "tcp dport { 4181, 10810 } accept" in nft
    assert "10809" not in nft  # the xray port stays unreachable
    assert nft.rstrip().splitlines()[-3].strip() == "counter reject"
    assert "FilterDefaultDeny Yes" in files["tinyproxy.conf"]
    assert r"^github\.com$" in files["tinyproxy.filter"]
    assert "NPM_CONFIG_IGNORE_SCRIPTS=true" in files["builder-proxy.env"]


def test_wildcard_and_bad_entries(gen):
    d, p = gen.parse_allowlist("domain *.example.org\nport 4181 # x\n")
    assert d == ["*.example.org"] and p == [4181]
    assert gen.domain_regex("*.example.org") == r"^(.+\.)?example\.org$"
    for bad in ("domain *.com", "domain not_a_host", "domain a.b c", "port 0", "port x", "host a.org", ""):
        with pytest.raises(gen.AllowlistError):
            gen.parse_allowlist(bad)


def test_xray_port_cannot_be_allowlisted(gen):
    with pytest.raises(gen.AllowlistError):
        gen.render_all("domain a.org\nport 10809\nport 10810", "b", 10810, ("127.0.0.1", 10809), "/f")
    with pytest.raises(gen.AllowlistError):
        gen.render_all("domain a.org\nport 4181", "b", 10810, ("127.0.0.1", 10809), "/f")


def test_dry_run_writes_nothing_and_write_then_clean(gen, tmp_path, capsys):
    out = tmp_path / "gen"
    assert gen.main(["--out-dir", str(out)]) == 0
    assert not out.exists()
    assert "+++ b/roxira_builder.nft" in capsys.readouterr().out
    assert gen.main(["--out-dir", str(out), "--write"]) == 0
    assert (out / "tinyproxy.filter").exists()
    capsys.readouterr()
    assert gen.main(["--out-dir", str(out)]) == 0
    assert capsys.readouterr().out.strip() == "no changes"


def test_bad_user_rejected(gen):
    with pytest.raises(gen.AllowlistError):
        gen.render_nft('x"; drop', [1])


# ---- PreToolUse guard ----

def bash(cmd):
    return {"tool_name": "Bash", "tool_input": {"command": cmd}}


@pytest.mark.parametrize("cmd", [
    "git push origin HEAD",
    "git -C /w push",
    "git remote set-url origin https://example.org/x",
    "gh pr comment 5 --body hi",
    "gh issue create --title t",
    "gh api repos/a/b/issues -f title=x",
    "npm install left-pad",
    "echo x > .github/workflows/ci.yml",
    "echo ANTHROPIC_API_KEY=" + A + " >> notes",
])
def test_guard_blocks(guard, cmd):
    assert guard.decide(bash(cmd))


@pytest.mark.parametrize("cmd", [
    "git commit -am x",
    "git status",
    "npm ci --ignore-scripts",
    "python3 scripts/ops/ci_box/builder_egress/gh_redact.py pr comment 5 --body hi",
    "gh pr view 5",
    "gh api repos/a/b/issues",
])
def test_guard_allows(guard, cmd):
    assert guard.decide(bash(cmd)) is None


def test_guard_blocks_workflow_edit_tools(guard):
    assert guard.decide({"tool_name": "Edit", "tool_input": {"file_path": "/w/.github/workflows/ci.yml"}})
    assert guard.decide({"tool_name": "Write", "tool_input": {"file_path": "/w/docs/a.md"}}) is None


# ---- gh wrapper ----

def test_gh_wrapper_redacts_before_exec(ghr, tmp_path, monkeypatch):
    log = tmp_path / "argv.txt"
    fake = tmp_path / "gh"
    fake.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$FAKE_LOG"\nfor a in "$@"; do [ -f "$a" ] && cat "$a" >> "$FAKE_LOG"; done\n')
    fake.chmod(fake.stat().st_mode | stat.S_IXUSR)
    body = tmp_path / "r.md"
    body.write_text("report from 203.0.113.7 key sk-ant-" + A)
    monkeypatch.setenv("GH_BIN", str(fake))
    monkeypatch.setenv("FAKE_LOG", str(log))
    rc = ghr.main(["gh_redact.py", "pr", "comment", "5", "--body", "mail a@b.org", "--body-file", str(body)])
    assert rc == 0
    seen = log.read_text()
    for leaked in ("a@b.org", "203.0.113.7", "sk-ant-"):
        assert leaked not in seen
    assert seen.count("[REDACTED:") >= 3


def test_gh_wrapper_passes_reads_and_refuses_api_writes(ghr, tmp_path, monkeypatch):
    fake = tmp_path / "gh"
    fake.write_text("#!/bin/sh\nexit 0\n")
    fake.chmod(fake.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("GH_BIN", str(fake))
    assert ghr.main(["gh_redact.py", "pr", "view", "5"]) == 0
    assert ghr.main(["gh_redact.py", "api", "x", "-f", "a=b"]) == 3
    assert os.environ["GH_BIN"] == str(fake)
