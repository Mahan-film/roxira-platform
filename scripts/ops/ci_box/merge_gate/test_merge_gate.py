"""Unit tests for merge_gate.py. gh is replaced by a fake api callable; no network."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import merge_gate as mg  # noqa: E402

HEAD = "a" * 40
CHECKS = ["c1", "c2"]
BOT = "github-actions[bot]"
HEAD_DATE = "2026-11-25T10:00:00Z"


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
        self.main_runs = kw.get("main_runs", [])
        self.desk_runs = kw.get("desk_runs", [])
        self.main_sha = kw.get("main_sha", "e" * 40)
        self.runs_by_sha = kw.get("runs_by_sha", {})
        self.head_date = kw.get("head_date", HEAD_DATE)

    def __call__(self, method, path, fields=None, paginate=False):
        self.calls.append((method, path, fields))
        if path.endswith("/merge"):
            if self.fail_merge:
                raise mg.GhError("405 not mergeable")
            return {"sha": "b" * 40}
        if path.endswith("/update-branch") or path.endswith("/comments") and method == "POST":
            return {}
        if path.endswith("/dispatches"):
            return None
        if "/workflows/ci.yml/runs" in path:
            return {"workflow_runs": self.main_runs}
        if "/workflows/review-desk.yml/runs" in path:
            return {"workflow_runs": self.desk_runs}
        if "/check-runs" in path:
            sha = path.split("/commits/", 1)[1].split("/", 1)[0]
            return [{"check_runs": self.runs_by_sha.get(sha, self.runs)}]
        if path.endswith("/commits/main"):
            return {"sha": self.main_sha}
        if "/commits/" in path:
            sha = path.rsplit("/", 1)[1]
            return {"sha": sha, "commit": {"committer": {"date": self.head_date}}}
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


def pr(n=7, labels=("merge-queue",), draft=False, head=HEAD, state="clean", auto=None, **extra):
    return {**extra, 
        "number": n, "draft": draft, "labels": [{"name": x} for x in labels],
        "head": {"sha": head}, "base": {"ref": "main"}, "mergeable_state": state,
        "auto_merge": auto,
    }


def run(name, status="completed", conclusion="success", id_=1):
    return {"name": name, "status": status, "conclusion": conclusion, "id": id_}


def review(verdict, sha=HEAD[:12], author=BOT):
    return {"user": {"login": author},
            "body": f"Cross-family review (m via p, family f) @ {sha}\n\n**Blocker**\n- none\n\nVerdict: {verdict}"}


def make(tmp_path, dry=False, cfg_over=None, notify=None, now=None, **kw):
    cfg = dict(mg.DEFAULTS, required_checks=CHECKS, approver_ids=[42], owner_approver_ids=[1],
               state_dir=str(tmp_path), dispatch_review_desk=False)
    cfg.update(cfg_over or {})
    api = FakeApi(**kw)
    extra = {"now": now} if now else {}
    return mg.Gate(cfg, api, mg.State(str(tmp_path), dry), dry, notify, **extra), api


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


def test_protected_path_blocks_without_owner_sentence(tmp_path):
    g, api = make(tmp_path, files=[{"filename": ".github/workflows/ci.yml"}])
    g.tick()
    assert not api.did("PUT", "/merge")
    assert "owner sentence required" in api.did("POST", "/comments")[0][2]["body"]


def owner_ok(uid=1, n=7, sha=HEAD[:7]):
    return {"user": {"id": uid}, "body": f"go ahead\nOWNER-OK #{n} {sha}\n"}


def test_protected_path_with_owner_sentence_by_allowlisted_id(tmp_path):
    g, api = make(tmp_path, files=[{"filename": "x/migrations/1.sql"}],
                  comments=[review("no blocker"), owner_ok()])
    assert g.tick() == "7"


def test_owner_sentence_by_stranger_wrong_pr_or_old_head_rejected(tmp_path):
    for c in (owner_ok(uid=5), owner_ok(n=8), owner_ok(sha="d" * 7)):
        g, api = make(tmp_path, files=[{"filename": "docker-compose.prod.yml"}],
                      comments=[review("no blocker"), c])
        g.tick()
        assert not api.did("PUT", "/merge")


def test_rename_out_of_protected_path_is_caught(tmp_path):
    f = [{"filename": "docs/a.sh", "previous_filename": "scripts/ops/deploy_x.sh"}]
    g, api = make(tmp_path, files=f)
    g.tick()
    assert not api.did("PUT", "/merge")


def test_behind_updates_branch_and_does_not_merge(tmp_path):
    g, api = make(tmp_path, behind=3, cfg_over={"require_up_to_date": True})
    assert g.tick() is None
    assert api.did("PUT", "/update-branch")[0][2] == {"expected_head_sha": HEAD}
    assert not api.did("PUT", "/merge")


def test_default_is_not_up_to_date_and_merges_a_behind_head(tmp_path):
    assert mg.DEFAULTS["require_up_to_date"] is False
    g, api = make(tmp_path, behind=80)
    assert g.tick() == "7"
    assert not api.did("PUT", "/update-branch") and not [c for c in api.calls if "/compare/" in c[1]]


def test_mergeable_unknown_waits_silently_then_merges(tmp_path):
    g, api = make(tmp_path, prs=[pr(mergeable=None, state="unknown")])
    assert g.tick() is None
    assert not api.did("POST", "/comments") and not api.did("PUT", "/merge")
    g, api = make(tmp_path, prs=[pr(mergeable=True)])
    assert g.tick() == "7"


def test_mergeable_false_refused_as_conflict(tmp_path):
    g, api = make(tmp_path, prs=[pr(mergeable=False, state="dirty")])
    g.tick()
    assert not api.did("PUT", "/merge") and "conflicts" in api.did("POST", "/comments")[0][2]["body"]


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


def test_json_pages_splits_paginate_output():
    assert mg.json_pages("") == []
    assert mg.json_pages('[1,2][3]') == [[1, 2], [3]]
    assert mg.json_pages('[1]\n[2]\n') == [[1], [2]]
    assert mg.json_pages('{"total_count":1,"check_runs":[]}\n{"a":2}') == [
        {"total_count": 1, "check_runs": []}, {"a": 2}]


def test_gh_api_paginate_flattens_pages(monkeypatch):
    class R:
        returncode = 0
        stdout = '[{"n":1},{"n":2}]\n[{"n":3}]'
        stderr = ""
    seen = {}

    def fake_run(cmd, **kw):
        seen["cmd"] = cmd
        return R()
    monkeypatch.setattr(mg.subprocess, "run", fake_run)
    assert mg.GhApi()("GET", "x", paginate=True) == [{"n": 1}, {"n": 2}, {"n": 3}]
    assert "--slurp" not in seen["cmd"] and "--paginate" in seen["cmd"]


# ---- main CI guard (decision B7-2) ---------------------------------------------------------
MERGE_SHA = "b" * 40


def main_run(status="completed", conclusion="success"):
    return {"status": status, "conclusion": conclusion, "head_sha": MERGE_SHA}


def merged_gate(tmp_path, **kw):
    """A live gate that has just merged #7 (last_merge recorded at t=1000) and now ticks at t=1000+later."""
    clock = {"t": 1000.0}
    sent = []
    g, api = make(tmp_path, now=lambda: clock["t"], notify=sent.append, **kw)
    assert g.tick() == "7"
    api.prs = [pr(n=9)]  # the next candidate
    return g, api, clock, sent


def test_no_second_merge_while_main_ci_of_last_merge_runs(tmp_path):
    g, api, clock, _ = merged_gate(tmp_path, main_runs=[main_run("in_progress", None)])
    clock["t"] += 60
    assert g.tick() is None
    assert len(api.did("PUT", "/merge")) == 1
    api.main_runs[:] = [main_run()]
    assert g.tick() == "9"


def test_waits_for_main_ci_to_start_then_treats_paths_ignored_push_as_passed(tmp_path):
    g, api, clock, _ = merged_gate(tmp_path, main_runs=[])
    clock["t"] += 60
    assert g.tick() is None  # grace period: the run may not have appeared yet
    clock["t"] += 400
    assert g.tick() == "9"  # no run after the grace period = docs-only push, nothing to wait for


def test_main_ci_failure_pauses_alerts_once_and_stays_paused(tmp_path):
    g, api, _, sent = merged_gate(tmp_path, main_runs=[main_run(conclusion="failure")],
                                  main_sha=MERGE_SHA, cfg_over={"auto_resume": False})
    assert g.tick() is None
    assert (tmp_path / "PAUSE").exists()
    assert len(sent) == 1 and "PAUSED" in sent[0] and "#7" in sent[0]
    api.main_runs[:] = [main_run()]  # main goes green again: still paused until a human removes the file
    assert g.tick() is None and g.tick() is None
    assert len(api.did("PUT", "/merge")) == 1 and len(sent) == 1
    (tmp_path / "PAUSE").unlink()
    assert g.tick() == "9"


def test_cancelled_main_run_is_not_a_failure(tmp_path):
    g, api, clock, sent = merged_gate(tmp_path, main_runs=[main_run(conclusion="cancelled")])
    assert g.tick() == "9" and not sent and not (tmp_path / "PAUSE").exists()


def test_dry_run_never_pauses_or_alerts(tmp_path):
    g, api = make(tmp_path, dry=True, notify=lambda t: (_ for _ in ()).throw(AssertionError("no alert in dry-run")))
    g.state.data["last_merge"] = {"pr": 7, "sha": MERGE_SHA, "at": 0, "done": False}
    api.main_runs = [main_run(conclusion="failure")]
    g.tick()
    assert not (tmp_path / "PAUSE").exists()


def test_alert_failure_does_not_break_tick(tmp_path):
    def boom(_):
        raise OSError("telegram down")
    g, api, clock, _ = merged_gate(tmp_path, main_runs=[main_run(conclusion="failure")])
    g.notify = boom
    assert g.tick() is None and (tmp_path / "PAUSE").exists()


# ---- dry-run dedupe persistence -------------------------------------------------------------
def test_dry_run_dedupe_persists_in_separate_file(tmp_path):
    g, api = make(tmp_path, dry=True, comments=[review("blocker")])
    g.tick()
    g.state.save()
    assert (tmp_path / "state.dryrun.json").exists() and not (tmp_path / "state.json").exists()
    g2 = mg.Gate(g.cfg, api, mg.State(str(tmp_path), True), True)
    seen = []
    import logging
    h = logging.Handler()
    h.emit = lambda rec: seen.append(rec.getMessage())
    logging.getLogger("merge_gate").addHandler(h)
    try:
        g2.tick()
    finally:
        logging.getLogger("merge_gate").removeHandler(h)
    assert not [m for m in seen if "would comment" in m]
    # the live state file is untouched, so the real comment is still posted at go-live
    assert not mg.State(str(tmp_path), False).seen(f"7:{HEAD}:review")


def test_main_saves_state_in_dry_run(tmp_path, monkeypatch):
    cfg = tmp_path / "c.toml"
    cfg.write_text(f'state_dir = "{tmp_path}/s"\ndry_run = true\nproxy = ""\n')
    api = FakeApi(comments=[review("blocker")])
    monkeypatch.setattr(mg, "GhApi", lambda *a, **k: api)
    monkeypatch.setattr(mg, "load_notify", lambda: (lambda t: False))
    assert mg.main(["--config", str(cfg)]) == 0
    assert (tmp_path / "s" / "state.dryrun.json").exists()


# ---- review desk dispatch ---------------------------------------------------------------------
def test_dispatches_review_desk_once_per_head_when_verdict_missing(tmp_path):
    g, api = make(tmp_path, comments=[], cfg_over={"dispatch_review_desk": True})
    g.tick()
    d = api.did("POST", "/workflows/review-desk.yml/dispatches")
    assert len(d) == 1 and d[0][2] == {"ref": "main", "inputs[pr]": "7"}
    g.tick()
    assert len(api.did("POST", "/workflows/review-desk.yml/dispatches")) == 1
    assert not api.did("PUT", "/merge")


def desk(tmp_path, sub, **kw):
    (tmp_path / sub).mkdir()
    return make(tmp_path / sub, cfg_over={"dispatch_review_desk": True}, **kw)


def test_dispatch_also_in_dry_run(tmp_path):
    g, api = desk(tmp_path, "a", dry=True, comments=[])
    g.tick()
    assert len(api.did("POST", "/dispatches")) == 1


def test_no_dispatch_while_desk_busy_or_when_verdict_present(tmp_path):
    g, api = desk(tmp_path, "a", comments=[], desk_runs=[{"status": "queued"}])
    g.tick()
    assert not api.did("POST", "/dispatches")
    g, api = desk(tmp_path, "b")  # verdict exists for the head
    g.tick()
    assert not api.did("POST", "/dispatches")


def test_one_dispatch_per_tick_and_none_for_conflicting_pr(tmp_path):
    g, api = desk(tmp_path, "a", comments=[], prs=[pr(n=7), pr(n=9)])
    g.tick()
    assert len(api.did("POST", "/dispatches")) == 1
    g, api = desk(tmp_path, "b", comments=[], prs=[pr(state="dirty")])
    g.tick()
    assert not api.did("POST", "/dispatches")  # a conflicting PR does not burn a desk run


# ---- hub/owner blocker verdicts hold (rule 4b) -------------------------------------------------
LATER, EARLIER = "2026-11-25T11:00:00Z", "2026-11-25T09:00:00Z"


def hub(body, uid=42, at=LATER):
    return {"user": {"id": uid, "login": "hub"}, "body": body, "created_at": at}


def evaluate(tmp_path, comments, **kw):
    g, api = make(tmp_path, comments=comments, **kw)
    return g.evaluate(api.prs[0]), api


def test_hub_blocker_verdict_after_head_holds(tmp_path):
    for body in ("Review\n\nVerdict: blocker", "**Verdict:** blocker - schema", "verdict: BLOCKER"):
        (st, code, why), _ = evaluate(tmp_path, [review("no blocker"), hub(body)])
        assert (st, code) == (mg.REFUSE, "hold"), body
        assert "Verdict: blocker" in why
    (st, code, _), _ = evaluate(tmp_path, [review("no blocker"), hub("Verdict: blocker", uid=1)])
    assert (st, code) == (mg.REFUSE, "hold")  # owner ids count too


def test_hub_verdict_before_head_or_no_blocker_or_stranger_does_not_hold(tmp_path):
    for c in (hub("Verdict: blocker", at=EARLIER), hub("Verdict: no blocker"),
              hub("Verdict: blocker", uid=99), hub("> Verdict: blocker")):
        (st, _, _), _ = evaluate(tmp_path, [review("no blocker"), c])
        assert st == mg.MERGE, c


def test_head_date_is_fetched_only_when_a_hub_verdict_appears(tmp_path):
    _, api = evaluate(tmp_path, [review("no blocker"), hub("looks fine")])
    assert not [c for c in api.calls if c[1].endswith(f"/commits/{HEAD}")]
    cs = [review("no blocker"), hub("Verdict: blocker"), hub("Verdict: blocker")]
    _, api = evaluate(tmp_path, cs)
    assert len([c for c in api.calls if c[1].endswith(f"/commits/{HEAD}")]) == 1


def test_unknown_head_date_or_comment_time_fails_closed(tmp_path):
    cs = [review("no blocker"), hub("Verdict: blocker", at=EARLIER)]
    (st, code, _), _ = evaluate(tmp_path, cs, head_date="")
    assert (st, code) == (mg.REFUSE, "hold")
    c = hub("Verdict: blocker")
    del c["created_at"]
    (st, code, _), _ = evaluate(tmp_path, [review("no blocker"), c])
    assert (st, code) == (mg.REFUSE, "hold")


def test_hub_verdict_hold_cleared_by_later_unblock_override_or_owner_ok(tmp_path):
    for clear in (hub("UNBLOCK: fixed in the head"),
                  hub(f"DESK-OVERRIDE #7 {HEAD[:7]}: verified by hand"),
                  hub(f"ok\nOWNER-OK #7 {HEAD[:7]}", uid=1)):
        cs = [review("no blocker"), hub("Verdict: blocker"), clear]
        (st, _, why), _ = evaluate(tmp_path, cs)
        assert st == mg.MERGE, (clear["body"], why)


def test_hub_verdict_hold_not_cleared_by_wrong_or_earlier_markers(tmp_path):
    for clear in (hub(f"DESK-OVERRIDE #8 {HEAD[:7]}: x"), hub("DESK-OVERRIDE #7 ddddddd: x"),
                  hub(f"DESK-OVERRIDE #7 {HEAD[:7]}: x", uid=99),
                  hub(f"OWNER-OK #7 {HEAD[:7]}", uid=42),  # OWNER-OK only from owner ids
                  hub("UNBLOCK: x", uid=99)):
        cs = [review("no blocker"), hub("Verdict: blocker"), clear]
        (st, code, _), _ = evaluate(tmp_path, cs)
        assert (st, code) == (mg.REFUSE, "hold"), clear["body"]
    early = hub(f"DESK-OVERRIDE #7 {HEAD[:7]}: x", at=EARLIER)
    (st, code, _), _ = evaluate(tmp_path, [review("no blocker"), early, hub("Verdict: blocker")])
    assert (st, code) == (mg.REFUSE, "hold")  # the newer opinion wins


def test_override_does_not_clear_a_blocker_comment_hold(tmp_path):
    cs = [review("no blocker"), hub("BLOCKER: schema"), hub(f"DESK-OVERRIDE #7 {HEAD[:7]}: x")]
    (st, code, why), _ = evaluate(tmp_path, cs)
    assert (st, code) == (mg.REFUSE, "hold") and "BLOCKER:" in why


def test_bot_desk_blocker_is_review_not_hold(tmp_path):
    (st, code, _), _ = evaluate(tmp_path, [review("blocker")])
    assert (st, code) == (mg.REFUSE, "review")


def test_gate_comment_text_is_neither_verdict_nor_override(tmp_path):
    g, api = make(tmp_path, comments=[review("blocker")])
    g.tick()
    posted = api.did("POST", "/comments")[0][2]["body"]
    api.comments.append(hub(posted, uid=1))
    assert g.evaluate(api.prs[0])[:2] == (mg.REFUSE, "review")


# ---- DESK-OVERRIDE (rule 4) ---------------------------------------------------------------
def test_desk_override_releases_review_for_exact_head(tmp_path):
    for c in (hub(f"DESK-OVERRIDE #7 {HEAD[:7]}: desk misread the diff"),
              hub(f"note\ndesk-override #7 {HEAD[:20].upper()} : reason", uid=1)):
        g, _ = make(tmp_path, comments=[review("blocker"), c])
        assert g.tick() == "7", c["body"]


def test_desk_override_invalid_forms_rejected(tmp_path):
    ok = f"DESK-OVERRIDE #7 {HEAD[:7]}"
    for body in (f"DESK-OVERRIDE #8 {HEAD[:7]}: x", "DESK-OVERRIDE #7 ddddddd: x",
                 "DESK-OVERRIDE #7 aaaaaa: x", ok, ok + ":", ok + ":\nx", ok + " \n: x",
                 "> " + ok + ": x", "please " + ok + ": x"):
        (st, code, _), _ = evaluate(tmp_path, [hub(body)])
        assert (st, code) == (mg.REFUSE, "review"), body
    (st, code, _), _ = evaluate(tmp_path, [hub(ok + ": x", uid=99)])
    assert (st, code) == (mg.REFUSE, "review")
    bot = {"user": {"login": BOT}, "body": ok + ": x"}
    (st, code, _), _ = evaluate(tmp_path, [bot])
    assert (st, code) == (mg.REFUSE, "review")


def test_desk_override_does_not_bypass_protected_paths_holds_or_checks(tmp_path):
    ov = hub(f"DESK-OVERRIDE #7 {HEAD[:7]}: x")
    (st, _, _), _ = evaluate(tmp_path, [ov], files=[{"filename": "x/migrations/1.sql"}])
    assert st == mg.OWNER
    (st, code, _), _ = evaluate(tmp_path, [ov], prs=[pr(labels=("merge-queue", "do-not-merge"))])
    assert (st, code) == (mg.REFUSE, "hold")
    (st, code, _), _ = evaluate(tmp_path, [ov], runs=[run("c1"), run("c2", conclusion="failure")])
    assert (st, code) == (mg.REFUSE, "checks")


# ---- B1 core globs (decision 2026-11-25) ---------------------------------------------------------
def test_b1_core_globs_are_protected():
    pats = mg.DEFAULTS["protected_globs"]

    def hit(p):
        return bool(mg.protected_hits([{"filename": p}], pats))
    for p in ("output_apps/ecosystem_core/country_packs/de/vat.yaml", "country_packs/ir/x.py",
              "output_apps/enterprise_hub/modules/tax_compliance/services/vat.service.ts",
              "output_apps/generated_modules/smartjudge/prompts/judge.py",
              "output_apps/nginx_config/roxira.conf"):
        assert hit(p), p
    assert not hit("output_apps/enterprise_hub/modules/tax_compliance_notes.md")
    assert not hit("docs/country_packs.md")


# ---- auto-resume -------------------------------------------------------------------------
def paused_gate(tmp_path, dry=False, main_sha=MERGE_SHA, runs=None, **kw):
    sent = []
    g, api = make(tmp_path, dry=dry, notify=sent.append, main_sha=main_sha,
                  main_runs=runs if runs is not None else [main_run()], **kw)
    (tmp_path / "PAUSE").write_text("main CI failure\n")
    return g, api, sent


def test_auto_resume_when_main_green_at_head(tmp_path):
    g, _, sent = paused_gate(tmp_path)
    assert g.tick() == "7"
    assert not (tmp_path / "PAUSE").exists()
    assert sent == [f"merge gate resumed: main green at {MERGE_SHA[:7]}"]
    g.tick()
    assert len(sent) == 1


def test_auto_resume_uses_the_newest_completed_run(tmp_path):
    runs = [dict(main_run(conclusion="failure"), created_at="2026-11-25T12:00:00Z", id=9),
            dict(main_run(), created_at="2026-11-25T11:00:00Z", id=8),
            dict(main_run("in_progress", None), created_at="2026-11-25T13:00:00Z", id=10)]
    g, _, sent = paused_gate(tmp_path, runs=runs)
    assert g.tick() is None and (tmp_path / "PAUSE").exists() and not sent


def test_no_auto_resume_when_green_run_is_not_main_head_or_red(tmp_path):
    cases = ({"main_sha": "f" * 40}, {"runs": [main_run(conclusion="failure")]}, {"runs": []},
             {"runs": [main_run("in_progress", None)]})
    for i, kw in enumerate(cases):
        sub = tmp_path / str(i)
        sub.mkdir()
        g, api, sent = paused_gate(sub, **kw)
        assert g.tick() is None, kw
        assert (sub / "PAUSE").exists() and not sent and not api.did("PUT", "/merge")


def test_no_auto_resume_with_kill_switch_dry_run_or_disabled(tmp_path):
    a, b, c = (tmp_path / x for x in "abc")
    for d in (a, b, c):
        d.mkdir()
    (a / "KILL").write_text("")
    g, _, sent = paused_gate(a)
    g.tick()
    assert (a / "PAUSE").exists() and not sent
    g, _, sent = paused_gate(b, dry=True)
    g.tick()
    assert (b / "PAUSE").exists() and not sent
    g, _, sent = paused_gate(c, cfg_over={"auto_resume": False})
    g.tick()
    assert (c / "PAUSE").exists() and not sent
    assert mg.DEFAULTS["auto_resume"] is True


def test_auto_resume_api_error_keeps_pause(tmp_path):
    g, api, sent = paused_gate(tmp_path)
    orig = api.__call__

    def broken(method, path, fields=None, paginate=False):
        if path.endswith("/commits/main"):
            raise mg.GhError("502")
        return orig(method, path, fields, paginate)
    g.api = broken
    assert g.tick() is None and (tmp_path / "PAUSE").exists() and not sent


def test_auto_resume_notice_failure_does_not_break_tick(tmp_path):
    g, _, _ = paused_gate(tmp_path)

    def boom(_):
        raise OSError("telegram down")
    g.notify = boom
    assert g.tick() == "7" and not (tmp_path / "PAUSE").exists()


# ---- review desk dispatch hygiene ---------------------------------------------------------
def desk_clock(tmp_path, sub, **kw):
    (tmp_path / sub).mkdir()
    clock = {"t": 1000.0}
    g, api = make(tmp_path / sub, cfg_over={"dispatch_review_desk": True},
                  now=lambda: clock["t"], **kw)
    return g, api, clock


def dispatches(api):
    return api.did("POST", "/workflows/review-desk.yml/dispatches")


def test_no_dispatch_while_checks_red_or_pending(tmp_path):
    red = [run("c1"), run("c2", conclusion="failure")]
    g, api, _ = desk_clock(tmp_path, "a", comments=[], runs=red)
    g.tick()
    assert not dispatches(api)
    g, api, _ = desk_clock(tmp_path, "b", comments=[], runs=[run("c1")])
    g.tick()
    assert not dispatches(api)


def test_red_pr_does_not_starve_a_green_one(tmp_path):
    other = "f" * 40
    g, api, _ = desk_clock(tmp_path, "a", comments=[], prs=[pr(n=7), pr(n=9, head=other)],
                           runs_by_sha={HEAD: [run("c1"), run("c2", conclusion="failure")]})
    orig = api.__call__

    def call(method, path, fields=None, paginate=False):
        if path.endswith("/pulls/9"):
            api.calls.append((method, path, fields))
            return api.prs[1]
        return orig(method, path, fields, paginate)
    g.api = call
    g.tick()
    d = dispatches(api)
    assert len(d) == 1 and d[0][2]["inputs[pr]"] == "9"


def test_redispatch_after_retry_window_up_to_cap(tmp_path):
    g, api, clock = desk_clock(tmp_path, "a", comments=[])
    g.tick()
    assert len(dispatches(api)) == 1
    clock["t"] += 89 * 60
    g.tick()
    assert len(dispatches(api)) == 1
    clock["t"] += 2 * 60
    g.tick()
    assert len(dispatches(api)) == 2
    clock["t"] += 10 * 3600
    g.tick()
    assert len(dispatches(api)) == 2  # desk_max_dispatches_per_head = 2
    assert g.state.dispatch_entry(f"7:{HEAD}")["count"] == 2


def test_no_redispatch_when_desk_gave_a_blocker_for_the_head(tmp_path):
    g, api, clock = desk_clock(tmp_path, "a", comments=[])
    g.tick()
    api.comments = [review("blocker")]
    clock["t"] += 3 * 3600
    g.tick()
    assert len(dispatches(api)) == 1
    g, api, clock = desk_clock(tmp_path, "b", comments=[review("blocker")])
    g.tick()
    assert not dispatches(api)


def test_no_redispatch_while_desk_busy(tmp_path):
    g, api, clock = desk_clock(tmp_path, "a", comments=[])
    g.tick()
    api.desk_runs = [{"status": "in_progress"}]
    clock["t"] += 3 * 3600
    g.tick()
    assert len(dispatches(api)) == 1
    api.desk_runs = []
    g.tick()
    assert len(dispatches(api)) == 2


def test_legacy_dispatch_entry_counts_once_from_now(tmp_path):
    g, api, clock = desk_clock(tmp_path, "a", comments=[])
    g.state.data["dispatched"] = [f"7:{HEAD}"]
    g.tick()
    assert not dispatches(api)
    clock["t"] += 91 * 60
    g.tick()
    assert len(dispatches(api)) == 1
    clock["t"] += 91 * 60
    g.tick()
    assert len(dispatches(api)) == 1


def test_dispatch_log_survives_save_and_reload(tmp_path):
    g, _, _ = desk_clock(tmp_path, "a", comments=[])
    g.tick()
    g.state.save()
    assert mg.State(str(tmp_path / "a")).dispatch_entry(f"7:{HEAD}") == {"count": 1, "at": 1000.0}
