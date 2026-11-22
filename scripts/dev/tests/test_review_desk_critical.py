"""Offline tests for T335 (#1284): a truncated or unreviewed critical file gives `Verdict: inconclusive`.

Fixtures are generated diffs shaped like the two PRs where the desk passed a cut critical file:
#1197 (the permission matrix snapshot) and #1219 (the import tie-out engine). No gh, no network, no keys.
The modules are loaded in a fixture, not at import time.
"""

import importlib.util
import json
import pathlib
import re
import sys
from types import SimpleNamespace

import pytest

DEV = pathlib.Path(__file__).resolve().parents[1]
HEAD = "e91ac02160cf4335211e3500d339a06774cb2b18"
MATRIX = "output_apps/enterprise_hub/modules/access/permission-matrix.snapshot.json"
ENGINE = "output_apps/enterprise_hub/modules/data_import/analysis/import-tie-out.engine.ts"


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod  # dataclasses look the module up while the class body runs
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def rd():
    return _load("review_desk", DEV / "review_desk.py")


def new_file_diff(path, rows, width=80):
    body = "\n".join(f"+{i:04d} " + "x" * width for i in range(rows))
    return (
        f"diff --git a/{path} b/{path}\nnew file mode 100644\n--- /dev/null\n+++ b/{path}\n"
        f"@@ -0,0 +1,{rows} @@\n{body}\n"
    )


def edit_diff(path, hunks, rows_per_hunk, width=100):
    out = [f"diff --git a/{path} b/{path}", f"--- a/{path}", f"+++ b/{path}"]
    for h in range(hunks):
        start = 1 + h * (rows_per_hunk + 50)
        out.append(f"@@ -{start},{rows_per_hunk} +{start},{rows_per_hunk} @@")
        for i in range(rows_per_hunk):
            out.append(f"-old {h}.{i} " + "o" * width)
            out.append(f"+new {h}.{i} " + "n" * width)
    return "\n".join(out) + "\n"


def all_rows(plan):
    return "\n".join("\n".join(chunk) for chunk in plan.chunks)


# ---- example 1: #1197 permission matrix (big critical file, cut by the old code) ----------------------


def test_permission_matrix_is_split_by_hunk_not_cut(rd):
    diff = new_file_diff(MATRIX, rows=700)  # ~58k chars: over the 40k per-file cap
    assert rd.is_critical(MATRIX)
    old = rd.number_lines(rd.split_diff(diff)[0], 40_000)
    assert "file truncated by the review desk" in old  # what the old code did to it
    plan = rd.plan_diff(diff)
    assert plan.truncated == [] and plan.not_reviewed == [] and plan.coverage_gaps() == []
    text = all_rows(plan)
    assert "part 1 of 2" in text and "part 2 of 2" in text
    assert "file truncated" not in text
    assert text.count("\n") >= 700
    assert "+0000 " in text and "+0699 " in text  # first and last row both reach the reviewer
    assert rd.final_verdict(rd.Review(verdict="no blocker"), plan) == "no blocker"


def test_split_keeps_new_file_line_numbers(rd):
    diff = new_file_diff(MATRIX, rows=700)
    fd = rd.split_diff(diff)[0]
    blocks = rd.split_by_hunk(fd, 40_000)
    assert len(blocks) == 2 and all(len(b) <= 40_000 for b in blocks)
    last_rows = [ln for ln in blocks[1].splitlines() if "+0699 " in ln]
    assert last_rows and last_rows[0].lstrip().startswith("700 +0699")


def test_small_critical_file_stays_one_block(rd):
    fd = rd.split_diff(new_file_diff(MATRIX, rows=10))[0]
    blocks = rd.split_by_hunk(fd, 40_000)
    assert len(blocks) == 1 and blocks[0] == rd.number_lines(fd, 40_000)


def test_one_huge_hunk_is_cut_on_line_boundaries_without_loss(rd):
    fd = rd.split_diff(edit_diff(MATRIX, hunks=1, rows_per_hunk=900))[0]
    blocks = rd.split_by_hunk(fd, 20_000)
    assert len(blocks) > 2
    joined = "\n".join(blocks)
    assert all(f"new 0.{i} " in joined for i in (0, 450, 899))
    assert all(f"old 0.{i} " in joined for i in (0, 450, 899))


# ---- example 2: #1219 tie-out engine (so big that part of it cannot be reviewed) ---------------------


def test_tie_out_engine_counts_as_critical(rd):
    assert rd.is_critical(ENGINE)


def test_critical_file_over_the_size_cap_is_inconclusive(rd):
    diff = edit_diff(ENGINE, hunks=3, rows_per_hunk=400)  # ~250k chars
    plan = rd.plan_diff(diff, chunk_chars=20_000, file_chars=40_000, max_chunks=2)
    assert plan.not_reviewed == [ENGINE]
    assert plan.coverage_gaps() == [ENGINE]
    assert rd.final_verdict(rd.Review(verdict="no blocker"), plan) == "inconclusive"
    # a real blocker is still a blocker; a missing verdict fails closed
    assert rd.final_verdict(rd.Review(blocker=["b"], verdict="no blocker"), plan) == "blocker"
    assert rd.final_verdict(rd.Review(verdict=None), rd.DiffPlan(chunks=[])) == "inconclusive"
    out = rd.format_comment(
        HEAD,
        [rd.Served("gemini-x", "gemini", "google", 10)],
        rd.Review(verdict="no blocker"),
        plan,
        author_fams={"anthropic"},
        trail=["gemini/gemini-x=ok(0.0s)"],
    )
    assert out.splitlines()[-1] == "Verdict: inconclusive"
    assert out.count("Verdict:") == 1
    assert "INCONCLUSIVE" in out and ENGINE in out
    assert rd.latest_review([{"body": out}])["verdict"] == "inconclusive"


def test_truncated_critical_gap_is_inconclusive_even_if_plan_is_hand_built(rd):
    plan = rd.DiffPlan(chunks=[["x"]], critical=[MATRIX], truncated=[MATRIX])
    assert rd.final_verdict(rd.Review(verdict="no blocker"), plan) == "inconclusive"


def test_non_critical_truncation_does_not_downgrade(rd):
    plan = rd.plan_diff(new_file_diff("docs/big-notes.md", rows=700))
    assert plan.truncated == ["docs/big-notes.md"] and plan.coverage_gaps() == []
    assert rd.final_verdict(rd.Review(verdict="no blocker"), plan) == "no blocker"


def test_summarised_critical_source_is_a_gap_but_lockfiles_and_binaries_are_not(rd):
    src = new_file_diff("services/auth/build/guard.py", rows=3)  # */build/* is summarised
    lock = new_file_diff("services/auth/package-lock.json", rows=3)
    binary = (
        "diff --git a/.github/logo.png b/.github/logo.png\nnew file mode 100644\n"
        "Binary files /dev/null and b/.github/logo.png differ\n"
    )
    plan = rd.plan_diff(src + lock + binary)
    assert set(plan.critical) >= {
        "services/auth/build/guard.py",
        "services/auth/package-lock.json",
        ".github/logo.png",
    }
    assert plan.coverage_gaps() == ["services/auth/build/guard.py"]


# ---- re-review, force and the PR list ---------------------------------------------------------------


def test_inconclusive_review_counts_as_reviewed_unless_forced(rd):
    body = f"Cross-family review (m via p, family f) @ {HEAD}\n\nVerdict: inconclusive"
    pr = {"isDraft": False, "state": "OPEN", "headRefOid": HEAD, "comments": [{"body": body}]}
    assert rd.latest_review(pr["comments"])["verdict"] == "inconclusive"
    assert rd.skip_reason(pr) == "already reviewed at head"
    assert rd.skip_reason(pr, force=True) is None


def test_parse_pr_list(rd):
    assert rd.parse_pr_list("") == [] and rd.parse_pr_list(None) == []
    assert rd.parse_pr_list("1197, #1219,1197,") == [1197, 1219]
    for bad in ("12a", "-3", "0", "1;rm", "1 2", "١٢"):
        with pytest.raises(ValueError):
            rd.parse_pr_list(bad)
    with pytest.raises(ValueError):
        rd.parse_pr_list(",".join(str(i) for i in range(1, 30)))


def test_workflow_has_prs_and_force_inputs():
    wf = (DEV.parents[1] / ".github" / "workflows" / "review-desk.yml").read_text(encoding="utf-8")
    assert re.search(r"^      prs:\n", wf, re.M) and re.search(r"^      force:\n", wf, re.M)
    assert "inputs.prs" in wf and "inputs.force" in wf
    assert "${{ inputs" not in wf.split("run: |", 1)[1]  # inputs reach the shell only through env


# ---- whole flow with a stubbed gh and model -----------------------------------------------------------


def run_desk(rd, monkeypatch, diff, answer, **kw):
    posted = []

    def gh(args, stdin=None):
        if args[:2] == ["pr", "view"] and "headRefOid" in args[-1] and "," not in args[-1]:
            return json.dumps({"headRefOid": HEAD})
        if args[:2] == ["pr", "view"]:
            return json.dumps(
                {
                    "number": 9,
                    "title": "t",
                    "body": "",
                    "isDraft": False,
                    "state": "OPEN",
                    "headRefOid": HEAD,
                    "author": {"login": "someone"},
                    "commits": [],
                    "comments": [],
                    "files": [],
                }
            )
        if args[:2] == ["pr", "diff"]:
            return diff
        if args[:2] == ["pr", "comment"]:
            body_file = pathlib.Path(args[args.index("--body-file") + 1])
            posted.append(body_file.read_text(encoding="utf-8"))
            return ""
        raise AssertionError(args)

    cand = rd.Candidate("gemini-x", "gemini", "google", False, (0.0, 0.0))
    monkeypatch.setattr(rd, "candidates", lambda fams: ([cand], []))
    monkeypatch.setattr(rd, "load_yaml", lambda path: {})
    monkeypatch.setattr(rd, "make_opener", lambda: None)
    monkeypatch.setattr(rd.model_registry, "roles", lambda *a, **k: {})

    def fake_attempt(c, pool, opener, served_log, *, timeout):
        served_log.append(rd.Served(c.model, c.provider, c.family, 5))
        return rd.llm_route.Attempt(f"{c.provider}/{c.model}", rd.ROLE, False, lambda m, t: ("", 0, 0))

    monkeypatch.setattr(rd, "make_attempt", fake_attempt)
    monkeypatch.setattr(
        rd.llm_route,
        "route",
        lambda task, msgs, attempts, **k: SimpleNamespace(
            text=answer, served="gemini/gemini-x", attempts=[("gemini/gemini-x", "ok")]
        ),
    )
    out = rd.review_pr(9, dry_run=False, force=False, gh=gh, log=lambda *a, **k: None, **kw)
    return out, posted


OK_ANSWER = "**Blocker**\n- none\n**Major**\n- none\n**Minor**\n- none\nVerdict: no blocker"


def test_flow_permission_matrix_is_reviewed_in_full_and_passes(rd, monkeypatch):
    out, posted = run_desk(rd, monkeypatch, new_file_diff(MATRIX, rows=700), OK_ANSWER)
    assert out.status == "posted" and out.verdict == "no blocker"
    assert posted[0].splitlines()[-1] == "Verdict: no blocker"
    assert "truncated" not in posted[0]


def test_flow_tie_out_engine_too_big_posts_inconclusive(rd, monkeypatch):
    diff = edit_diff(ENGINE, hunks=3, rows_per_hunk=900)  # far beyond 4 chunks of 20k
    out, posted = run_desk(rd, monkeypatch, diff, OK_ANSWER, chunk_chars=20_000)
    assert out.status == "posted" and out.verdict == "inconclusive"
    assert posted[0].splitlines()[-1] == "Verdict: inconclusive"
    assert "Verdict: no blocker" not in posted[0]


# ---- every consumer treats inconclusive as not mergeable ----------------------------------------------


def inconclusive_comment(rd):
    plan = rd.DiffPlan(chunks=[["x"]], critical=[ENGINE], not_reviewed=[ENGINE])
    return rd.format_comment(
        HEAD,
        [rd.Served("gemini-x", "gemini", "google", 10)],
        rd.Review(verdict="no blocker"),
        plan,
        author_fams=set(),
        trail=[],
    )


def test_consumers_do_not_accept_inconclusive(rd):
    body = inconclusive_comment(rd)
    assert body.splitlines()[-1] == "Verdict: inconclusive"
    root = DEV.parents[1]
    # scripts/ops/ci_box/merge_gate/merge_gate.py (the box merge gate)
    mg = _load("merge_gate_t335", root / "scripts/ops/ci_box/merge_gate/merge_gate.py")
    gate = object.__new__(mg.Gate)
    gate.api = lambda method, path, paginate=False: [{"user": {"login": "bot"}, "body": body}]
    gate.p = lambda path: path
    gate.cfg = {"approver_ids": []}
    gate.is_review_author = lambda c: True
    ok, why = gate.review_ok(7, HEAD)
    assert ok is False and "no-blocker" not in why
    good = body.replace("Verdict: inconclusive", "Verdict: no blocker")
    gate.api = lambda method, path, paginate=False: [{"user": {"login": "bot"}, "body": good}]
    assert gate.review_ok(7, HEAD)[0] is True  # the stub is live: a real pass is still accepted
    # scripts/dev/verify_agent_report.py
    var = _load("verify_agent_report_t335", DEV / "verify_agent_report.py")
    assert var.latest_review([{"body": body}], HEAD) not in ("no blocker",)
    # scripts/dev/hub_autopilot.sh: only the literal "Verdict: no blocker" queues a PR
    sh = (DEV / "hub_autopilot.sh").read_text(encoding="utf-8")
    assert sh.count('test("Verdict: no blocker")') == 1 and "inconclusive" not in sh
    assert re.search("Verdict: no blocker", body) is None
