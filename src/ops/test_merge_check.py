"""Offline tests for scripts/dev/merge_check.py (fake gh, no network)."""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
mc = None
CFG = None


@pytest.fixture(autouse=True, scope="module")
def _load_merge_check():
    """Load scripts/dev/merge_check.py inside a fixture (no import-time code in this file)."""
    global mc, CFG
    path = ROOT / "scripts/dev/merge_check.py"
    spec = importlib.util.spec_from_file_location("merge_check", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["merge_check"] = module
    spec.loader.exec_module(module)
    mc = module
    CFG = module.load_config()
    yield


def mkdiff(name, added=(), removed=(), new=False, deleted=False):
    out = [f"diff --git a/{name} b/{name}"]
    if new:
        out.append("new file mode 100644")
    if deleted:
        out.append("deleted file mode 100644")
    out += [f"--- a/{name}", f"+++ b/{name}", "@@ -1 +1 @@"]
    out += [f"+{x}" for x in added] + [f"-{x}" for x in removed]
    return "\n".join(out) + "\n"


def run(files, labels=(), adds=10, dels=0, state="OPEN"):
    """files: list of (diff_text, path)."""
    pr = {
        "number": 1,
        "state": state,
        "isDraft": False,
        "headRefOid": "abc",
        "labels": [{"name": n} for n in labels],
        "files": [{"path": p} for _, p in files],
        "additions": adds,
        "deletions": dels,
    }
    diff = "".join(d for d, _ in files)

    def fake_gh(args):
        return json.dumps(pr) if args[:2] == ["pr", "view"] else diff

    return mc.check(1, gh=fake_gh, cfg=CFG)


def test_docs_only_auto():
    text, code, _ = run([(mkdiff("docs/x.md", ["hi"]), "docs/x.md")])
    assert code == 0 and text.startswith("AUTO_MERGE_OK (L0)")


def test_code_with_new_test_auto():
    files = [
        (mkdiff("src/a.py", ["x=1"]), "src/a.py"),
        (mkdiff("src/test_a.py", ["def test_a():", "    pass"], new=True), "src/test_a.py"),
    ]
    text, code, _ = run(files)
    assert code == 0 and "L1" in text


def test_code_without_test_owner_review():
    text, code, _ = run([(mkdiff("src/a.py", ["x=1"]), "src/a.py")])
    assert code == 10 and "without a new or extended test" in text


def test_too_large_owner_review():
    files = [
        (mkdiff("src/a.py", ["x"]), "src/a.py"),
        (mkdiff("src/test_a.py", ["def test_a():"], new=True), "src/test_a.py"),
    ]
    text, code, _ = run(files, adds=401)
    assert code == 10 and "changed lines" in text


def test_deleted_test_blocks():
    d = mkdiff("src/test_a.py", removed=["def test_a():"], deleted=True)
    text, code, _ = run([(d, "src/test_a.py")])
    assert code == 20 and "test file deleted" in text


def test_reduced_test_blocks():
    d = mkdiff("src/test_a.py", ["pass"], ["def test_a():", "    assert 1", "    assert 2"])
    text, code, _ = run([(d, "src/test_a.py")])
    assert code == 20 and "reduced" in text and "net deletion of test functions" in text


def test_reviewer_fail_blocks():
    text, code, _ = run([(mkdiff("docs/x.md", ["a"]), "docs/x.md")], labels=["review:fail"])
    assert code == 20 and "reviewer" in text


def test_l2_needs_label():
    files = [(mkdiff("config/models.yaml", ["a: b"]), "config/models.yaml")]
    text, code, _ = run(files)
    assert code == 10 and text.startswith("OWNER_REVIEW(L2)")
    _, code2, _ = run(files, labels=["hub-approved"])
    assert code2 == 0


def test_l3_paths_owner_review():
    for p in ["api/src/auth/guard.ts", "db/migrations/001.sql", "app/x.dto.ts"]:
        text, code, _ = run([(mkdiff(p, ["a"]), p)], labels=["hub-approved"])
        assert code == 10 and "OWNER_REVIEW(L3)" in text, p


def test_manifest_flagged_and_l3():
    text, code, _ = run([(mkdiff("package-lock.json", ["a"]), "package-lock.json")])
    assert code == 10 and "lockfile" in text and "L3" in text


def test_l4_paths():
    paths = [".github/workflows/ci.yml", "scripts/ci/merge_gate.py", "docker-compose.yml"]
    for p in [*paths, "scripts/dev/rx"]:
        text, code, _ = run([(mkdiff(p, ["a"]), p)])
        assert code == 10 and "OWNER_REVIEW(L4)" in text, p


def test_closed_pr_blocks():
    _, code, _ = run([(mkdiff("docs/x.md", ["a"]), "docs/x.md")], state="MERGED")
    assert code == 20


def test_gh_failure_blocks(capsys, monkeypatch):
    def boom(args):
        raise RuntimeError("nope")

    monkeypatch.setattr(mc, "gh_run", boom)
    monkeypatch.setattr(mc, "check", lambda *a, **k: boom([]))
    assert mc.main(["5"]) == 20
    assert "BLOCK" in capsys.readouterr().out
