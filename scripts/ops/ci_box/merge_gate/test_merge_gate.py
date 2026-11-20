"""Unit tests for merge_gate.py. gh is replaced by a fake api callable; no network."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import merge_gate as mg  # noqa: E402

HEAD = "a" * 40
CHECKS = ["c1", "c2"]
BOT = "github-actions[bot]"


class FakeApi:
    def __init__(self, **kw):
        self.calls = []
        self.files = kw.get("files", [{"filename": "docs/x.md"}])
        self.comments = kw.get("comments", [review("no blocker")])
        self.reviews = kw.get("reviews", [])
        self.timeline = kw.get("timeline", [])
        self.runs = kw.get("runs", [run("c1"), run("c2")])
        self.behind = kw.get("behind", 0)
        self.prs = kw.get("prs", [pr()])
        self.fail_merge = kw.get("fail_merge", False)

    def __call__(self, method, path, fields=None, paginate=False):
        self.calls.append((method, path, fields))
        if path.endswith("/merge"):
            if self.fail_merge:
                raise mg.GhError("405 not mergeable")
            return {"sha": "b" * 40}
        if path.endswith("/update-branch") or path.endswith("/comments") and method == "POST":
            return {}
        if "/check-runs" in path:
            return [{"check_runs": self.runs}]
        if "/compare/" in path:
            return {"behind_by": self.behind}
        if path.endswith("/files?per_page=100"):
            return self.files
        if "/comments?" in path:
            return self.comments
        if "/reviews?" in path:
            return self.reviews
        if "/timeline?" in path:
            return self.timeline
        if "/pulls?state=open" in path:
            return list(self.prs)
        if "/pulls/" in path:
            return self.prs[0]
        raise AssertionError(path)

    def did(self, method, suffix):
        return [c for c in self.calls if c[0] == method and c[1].endswith(suffix)]


def pr(n=7, labels=("merge-queue",), draft=False, head=HEAD, state="clean", auto=None):
    return {
        "number": n, "draft": draft, "labels": [{"name": x} for x in labels],
        "head": {"sha": head}, "base": {"ref": "main"}, "mergeable_state": state,
        "auto_merge": auto,
    }


def run(name, status="completed", conclusion="success", id_=1):
    return {"name": name, "status": status, "conclusion": conclusion, "id": id_}


def review(verdict, sha=HEAD[:12], author=BOT):
    return {"user": {"login": author},
            "body": f"Cross-family review (m via p, family f) @ {sha}\n\n**Blocker**\n- none\n\nVerdict: {verdict}"}


def make(tmp_path, dry=False, **kw):
    cfg = dict(mg.DEFAULTS, required_checks=CHECKS, approver_ids=[42], owner_approver_ids=[1],
               state_dir=str(tmp_path))
    api = FakeApi(**kw)
    return mg.Gate(cfg, api, mg.State(str(tmp_path)), dry), api


def test_merges_when_all_green(tmp_path):
    g, api = make(tmp_path)
    assert g.tick() == "7"
    m = api.did("PUT", "/merge")[0]
    assert m[2] == {"sha": HEAD, "merge_method": "squash"}
    assert api.did("POST", "/comments")


def test_dry_run_changes_nothing(tmp_path):
    g, api = make(tmp_path, dry=True)
    assert g.tick() is None
    assert not api.did("PUT", "/merge") and not api.did("POST", "/comments")


def test_no_label_skipped_auto_merge_accepted(tmp_path):
    g, api = make(tmp_path, prs=[pr(labels=())])
    g.tick()
    assert not api.did("PUT", "/merge")
    g, api = make(tmp_path, prs=[pr(labels=(), auto={"merge_method": "squash"})])
    assert g.tick() == "7"


def test_draft_skipped(tmp_path):
    g, api = make(tmp_path, prs=[pr(draft=True)])
    assert g.tick() is None and not api.did("PUT", "/merge")


def test_review_for_old_sha_refused_once(tmp_path):
    g, api = make(tmp_path, comments=[review("no blocker", sha="c" * 12)])
    g.tick()
    g.tick()
    assert not api.did("PUT", "/merge")
    assert len(api.did("POST", "/comments")) == 1


def test_blocker_verdict_refused(tmp_path):
    g, api = make(tmp_path, comments=[review("blocker")])
    g.tick()
    assert not api.did("PUT", "/merge")


def test_review_from_stranger_ignored(tmp_path):
    g, api = make(tmp_path, comments=[review("no blocker", author="mallory")])
    g.tick()
    assert not api.did("PUT", "/merge")


def test_human_approval_on_head(tmp_path):
    rv = [{"user": {"id": 42}, "state": "APPROVED", "commit_id": HEAD}]
    g, api = make(tmp_path, comments=[], reviews=rv)
    assert g.tick() == "7"


def test_human_approval_stale_or_withdrawn(tmp_path):
    stale = [{"user": {"id": 42}, "state": "APPROVED", "commit_id": "d" * 40}]
    g, api = make(tmp_path, comments=[], reviews=stale)
    g.tick()
    assert not api.did("PUT", "/merge")
    withdrawn = [{"user": {"id": 42}, "state": "APPROVED", "commit_id": HEAD},
                 {"user": {"id": 42}, "state": "CHANGES_REQUESTED", "commit_id": HEAD}]
    g, api = make(tmp_path, comments=[], reviews=withdrawn)
    g.tick()
    assert not api.did("PUT", "/merge")


def test_unknown_approver_rejected(tmp_path):
    rv = [{"user": {"id": 99}, "state": "APPROVED", "commit_id": HEAD}]
    g, api = make(tmp_path, comments=[], reviews=rv)
    g.tick()
    assert not api.did("PUT", "/merge")


def test_pending_check_waits_silently(tmp_path):
    g, api = make(tmp_path, runs=[run("c1"), run("c2", status="in_progress", conclusion=None)])
    g.tick()
    assert not api.did("PUT", "/merge") and not api.did("POST", "/comments")


def test_missing_check_waits_failed_refuses(tmp_path):
    g, api = make(tmp_path, runs=[run("c1")])
    g.tick()
    assert not api.did("PUT", "/merge") and not api.did("POST", "/comments")
    g, api = make(tmp_path, runs=[run("c1"), run("c2", conclusion="failure")])
    g.tick()
    assert not api.did("PUT", "/merge") and api.did("POST", "/comments")


def test_rerun_uses_latest_run_and_skipped_is_green(tmp_path):
    runs = [run("c1"), run("c2", conclusion="failure", id_=1), run("c2", conclusion="skipped", id_=2)]
    g, api = make(tmp_path, runs=runs)
    assert g.tick() == "7"


def test_protected_path_blocks_without_owner_label(tmp_path):
    g, api = make(tmp_path, files=[{"filename": ".github/workflows/ci.yml"}])
    g.tick()
    assert not api.did("PUT", "/merge")
    assert "protected" in api.did("POST", "/comments")[0][2]["body"]


def test_protected_path_with_owner_label_by_allowlisted_actor(tmp_path):
    tl = [{"event": "labeled", "label": {"name": "owner-approved"}, "actor": {"id": 1}}]
    g, api = make(tmp_path, files=[{"filename": "x/migrations/1.sql"}], timeline=tl,
                  prs=[pr(labels=("merge-queue", "owner-approved"))])
    assert g.tick() == "7"


def test_owner_label_by_stranger_rejected(tmp_path):
    tl = [{"event": "labeled", "label": {"name": "owner-approved"}, "actor": {"id": 5}}]
    g, api = make(tmp_path, files=[{"filename": "docker-compose.prod.yml"}], timeline=tl,
                  prs=[pr(labels=("merge-queue", "owner-approved"))])
    g.tick()
    assert not api.did("PUT", "/merge")


def test_rename_out_of_protected_path_is_caught(tmp_path):
    f = [{"filename": "docs/a.sh", "previous_filename": "scripts/ops/deploy_x.sh"}]
    g, api = make(tmp_path, files=f)
    g.tick()
    assert not api.did("PUT", "/merge")


def test_behind_updates_branch_and_does_not_merge(tmp_path):
    g, api = make(tmp_path, behind=3)
    assert g.tick() is None
    assert api.did("PUT", "/update-branch")[0][2] == {"expected_head_sha": HEAD}
    assert not api.did("PUT", "/merge")


def test_one_merge_per_tick(tmp_path):
    g, api = make(tmp_path, prs=[pr(n=7), pr(n=9)])
    g.tick()
    assert len(api.did("PUT", "/merge")) == 1


def test_merge_error_commented_not_raised(tmp_path):
    g, api = make(tmp_path, fail_merge=True)
    assert g.tick() is None
    assert "refused by GitHub" in api.did("POST", "/comments")[0][2]["body"]


def test_conflict_refused(tmp_path):
    g, api = make(tmp_path, prs=[pr(state="dirty")])
    g.tick()
    assert not api.did("PUT", "/merge") and api.did("POST", "/comments")


def test_glob_matching():
    pats = mg.DEFAULTS["protected_globs"]
    hit = lambda p: bool(mg.protected_hits([{"filename": p}], pats))  # noqa: E731
    assert hit("migrations/1.sql") and hit("a/b/migrations/1.sql") and hit(".github/workflows/x/y.yml")
    assert hit("scripts/ops/deploy.sh") and hit("scripts/ops/deploy_x.sh") and hit("docker-compose.prod.yml")
    assert not hit("docs/migrations_notes.md") and not hit("scripts/ops/deploy/x.sh")
    assert not hit("docker-compose.yml")


def test_state_persists_dedupe(tmp_path):
    g, api = make(tmp_path, comments=[])
    g.tick()
    g.state.save()
    g2 = mg.Gate(g.cfg, api, mg.State(str(tmp_path)), False)
    g2.tick()
    assert len(api.did("POST", "/comments")) == 1


def test_kill_switch_and_lock(tmp_path, monkeypatch):
    cfg = tmp_path / "c.toml"
    cfg.write_text(f'state_dir = "{tmp_path}/s"\ndry_run = false\n')
    (tmp_path / "s").mkdir()
    (tmp_path / "s" / "KILL").write_text("")
    monkeypatch.setattr(mg, "GhApi", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not run")))
    assert mg.main(["--config", str(cfg)]) == 0
