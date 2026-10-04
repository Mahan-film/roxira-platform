"""Offline tests for scripts/ops/export_public.py (no import-time code)."""

import importlib.util
import json
import subprocess
from pathlib import Path

import pytest


@pytest.fixture
def ep():
    spec = importlib.util.spec_from_file_location(
        "export_public", Path(__file__).parents[2] / "scripts/ops/export_public.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def cfg():
    return json.loads((Path(__file__).parents[2] / "config/public_export.json").read_text())


def _git(repo, *args):
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)


def _make_repo(base, files):
    repo = base / "repo"
    repo.mkdir()
    _git(repo, "init", "-q")
    for name, content in files.items():
        p = repo / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
    _git(repo, "add", "-A")
    return repo


def _redactions(tmp_path, lines="# none\n"):
    p = tmp_path / "red.txt"
    p.write_text(lines)
    return p


def test_denylist_exclusion(ep, cfg, tmp_path):
    repo = _make_repo(
        tmp_path,
        {
            "src/a.py": "x = 1\n",
            "README.md": "hi\n",
            "data/x.txt": "d",
            "CLAUDE.md": "c",
            "SYSTEM_STATUS.md": "s",
            "scripts/ops/deploy.sh": "echo",
            "scripts/ok.py": "y = 2\n",
            "docs/OPERATIONS_RUNBOOK.md": "r",
            "docs/ips.md": "server " + ".".join(["8", "8", "8", "8"]) + "\n",
            "docs/fine.md": "fine\n",
            "output_apps/generated_modules/PROJ-1/m.py": "z",
            "output_apps/generated_modules/smartjudge/m.py": "z",
            "src/.env.local": "A=1",
        },
    )
    keep, skipped = ep.select_files(repo, cfg)
    assert set(keep) == {
        "src/a.py",
        "README.md",
        "scripts/ok.py",
        "docs/fine.md",
        "output_apps/generated_modules/smartjudge/m.py",
    }
    assert skipped == ["docs/ips.md"]


def test_redaction_counts_without_values(ep, cfg, tmp_path, capsys):
    repo = _make_repo(tmp_path, {"src/a.py": "# owner me@example.org and me@example.org\n"})
    out = tmp_path / "out"
    rc = ep.export(repo, out, cfg, _redactions(tmp_path, r"me@example\.org" + "\n"))
    text = capsys.readouterr().out
    assert rc == 0
    assert "redaction replacements: 2" in text
    assert "example.org" not in text
    assert "[REDACTED]" in (out / "src/a.py").read_text()


def test_missing_redactions_aborts(ep, cfg, tmp_path):
    repo = _make_repo(tmp_path, {"src/a.py": "x\n"})
    out = tmp_path / "out"
    assert ep.export(repo, out, cfg, tmp_path / "nope.txt") == 2
    assert not out.exists()


def _samples():
    """Key-shaped fixtures built by concatenation (built inside a function: no import-time code)."""
    return {
        "tavily": "tvly-" + "dev-" + "a1b2c3d4e5f6g7h8",
        "brave": "BSA" + "x" * 24,
        "groq": "gsk_" + "a" * 24,
        "google_api": "AIza" + "b" * 35,
        "openrouter": "sk-or-v1-" + "c" * 20,
        "anthropic": "sk-ant-" + "d" * 20,
        "xai": "xai-" + "e" * 24,
        "perplexity": "pplx-" + "f" * 24,
        "jina": "jina_" + "g" * 24,
        "firecrawl": "fc-" + "ab12" * 8,
        "google_oauth_secret": "GOCSPX-" + "h" * 14,
        "google_oauth_client": "000000-fakeid" + ".apps.googleusercontent.com",
        "named_assignment": 'MY_API_KEY = "' + "z" * 24 + '"',
        "private_key_block": "-----BEGIN RSA PRIVATE" + " KEY-----",
        "public_ipv4": "host " + ".".join(["8", "8", "4", "4"]),
    }


RULES = [
    "tavily",
    "brave",
    "groq",
    "google_api",
    "openrouter",
    "anthropic",
    "xai",
    "perplexity",
    "jina",
    "firecrawl",
    "google_oauth_secret",
    "google_oauth_client",
    "named_assignment",
    "private_key_block",
    "public_ipv4",
]


@pytest.mark.parametrize("rule", sorted(RULES))
def test_each_rule_trips_gate(ep, tmp_path, rule):
    (tmp_path / "f.txt").write_text(_samples()[rule] + "\n")
    hits = ep.secret_gate(tmp_path)
    assert rule in hits.get("f.txt", {})


def test_gate_ignores_private_and_short(ep, tmp_path):
    (tmp_path / "f.txt").write_text(
        'ip 10.0.0.1 192.168.1.1 127.0.0.1 192.0.2.5\nAPI_KEY = "short"\n'
    )
    assert ep.secret_gate(tmp_path) == {}


def test_marker_only_on_success(ep, cfg, tmp_path, capsys):
    good = _make_repo(tmp_path, {"src/a.py": "x = 1\n"})
    out = tmp_path / "out_ok"
    assert ep.export(good, out, cfg, _redactions(tmp_path)) == 0
    assert (out / "PUBLIC_EXPORT_OK").exists()
    assert (out / "PUBLIC_EXPORT_MANIFEST.json").exists()

    bad_root = tmp_path / "b"
    bad_root.mkdir()
    bad = _make_repo(bad_root, {"src/a.py": _samples()["groq"] + "\n"})
    out2 = tmp_path / "out_bad"
    assert ep.export(bad, out2, cfg, _redactions(tmp_path)) == 1
    assert not (out2 / "PUBLIC_EXPORT_OK").exists()
    printed = capsys.readouterr().out
    assert "GATE HIT src/a.py" in printed
    assert "a" * 24 not in printed


def test_refuses_out_inside_repo(ep, cfg, tmp_path):
    repo = _make_repo(tmp_path, {"src/a.py": "x\n"})
    assert ep.export(repo, repo / "out", cfg, _redactions(tmp_path)) == 2
    assert not (repo / "out").exists()


def test_refuses_nonempty_out(ep, cfg, tmp_path):
    repo = _make_repo(tmp_path, {"src/a.py": "x\n"})
    out = tmp_path / "out"
    out.mkdir()
    (out / "junk").write_text("j")
    assert ep.export(repo, out, cfg, _redactions(tmp_path)) == 2
