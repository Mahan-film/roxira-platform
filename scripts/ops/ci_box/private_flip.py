#!/usr/bin/env python3
"""Private flip of Mahan-film/roxira-platform (GitHub Free). Used through private_flip.sh.

Default is --dry-run: verify the prerequisites (read-only) and print what --apply would do.
--apply additionally needs --owner-go (the owners said "go private", checklist section 0) and refuses to start
when any prerequisite fails. Rollback commands are printed, never run.

The prerequisite logic (the check_* functions) is pure: it takes already-fetched data, so it is unit-tested without
network (src/ops/test_box_private_flip.py). gh is called only from the Gh class and the step functions.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tomllib
from pathlib import Path

REPO = "Mahan-film/roxira-platform"
DEFAULT_GATE_TOML = "~/.config/roxira-merge-gate/merge_gate.toml"
GATE_PY = Path(__file__).resolve().parent / "merge_gate" / "merge_gate.py"
MODES_OK = {"auto", "box"}  # CI_RUNNER_MODE values that put CI on the box; "hosted" or unset does not
HOSTED_PREFIX = "GitHub Actions"  # runner_name of hosted jobs (Pick runner and the like)
MAIN_RUNS_WANTED = 3

Result = tuple[bool, str]  # (ok, evidence)


# ---- pure prerequisite logic ------------------------------------------------------------------------------------


def check_gate_live(toml_text: str) -> Result:
    """The merge gate must be live: dry_run = false in the live config."""
    try:
        cfg = tomllib.loads(toml_text)
    except tomllib.TOMLDecodeError as e:
        return False, f"gate config unreadable: {e}"
    if "dry_run" not in cfg:
        return False, "dry_run missing in gate config (the code default is dry-run)"
    if cfg["dry_run"] is not False:
        return False, f"dry_run = {json.dumps(cfg['dry_run'])}, expected false"
    return True, "dry_run = false"


def check_runner_mode(value: str | None) -> Result:
    v = (value or "").strip()
    if not v:
        return False, "CI_RUNNER_MODE is not set"
    if v not in MODES_OK:
        return False, f"CI_RUNNER_MODE = {v}, expected one of {sorted(MODES_OK)}"
    return True, f"CI_RUNNER_MODE = {v}"


def _is_jit(name: str) -> bool:
    return name.startswith("jit-")


def counted_runs(runs: list[dict], want: int = MAIN_RUNS_WANTED) -> list[dict]:
    """The newest `want` completed main runs that count.

    Cancelled runs are skipped: on main a newer push replaces the pending run of the
    shared concurrency group, so `cancelled` there means "superseded", not "red" (a busy
    merge hour would otherwise never show three in a row).
    """
    counted = [r for r in runs if r.get("status") == "completed" and r.get("conclusion") != "cancelled"]
    return counted[:want]


def check_main_runs(runs: list[dict], jobs_by_run: dict[int, list[dict]], want: int = MAIN_RUNS_WANTED) -> Result:
    """The last `want` completed CI runs on main are green, and their box jobs ran on JIT runners.

    runs: workflow runs of CI on main, newest first (fields: id, status, conclusion). Runs that are not completed are
    ignored (a run in flight says nothing yet), and so are cancelled ones (see counted_runs). jobs_by_run: id -> jobs (fields: name, conclusion, runner_name).
    A job with no runner_name never started (skipped) and is ignored; a hosted job ("GitHub Actions ...") is fine;
    any other runner (the retired old runner, a stray name) fails the check; at least one jit- job is required.
    """
    done = counted_runs(runs, want)
    if len(done) < want:
        return False, f"only {len(done)} completed (not cancelled) main CI runs, need {want}"
    problems: list[str] = []
    for r in done:
        rid = r["id"]
        if r.get("conclusion") != "success":
            problems.append(f"run {rid} concluded {r.get('conclusion') or 'none'}")
            continue
        names = [j.get("runner_name") or "" for j in jobs_by_run.get(rid, [])]
        names = [n for n in names if n]
        stray = [n for n in names if not _is_jit(n) and not n.startswith(HOSTED_PREFIX)]
        if stray:
            problems.append(f"run {rid} had a job on a non-JIT runner")
        elif not any(_is_jit(n) for n in names):
            problems.append(f"run {rid} had no job on a JIT runner")
    if problems:
        return False, "; ".join(problems)
    return True, f"last {want} main CI runs green on JIT runners: " + ", ".join(str(r["id"]) for r in done)


def evaluate_prereqs(results: list[tuple[str, Result]]) -> tuple[bool, list[str]]:
    """All must pass. Returns (ok, report lines)."""
    lines = [f"  [{'ok' if ok else 'FAIL'}] {name}: {ev}" for name, (ok, ev) in results]
    return all(ok for _, (ok, _) in results), lines


def label_state(label_exists: bool, gate_label: str, wanted: str = "merge-queue") -> Result:
    """The gate must look for the merge-queue label and that label must exist in the repo (or the owners cannot set it)."""
    if gate_label != wanted:
        return False, f"gate config label is {gate_label!r}, expected {wanted!r}"
    if not label_exists:
        return False, f"label {wanted!r} does not exist in the repo"
    return True, f"label {wanted!r} exists and the gate is configured for it"


def rollback_commands(repo: str = REPO) -> list[str]:
    return [
        f"gh repo edit {repo} --visibility public --accept-visibility-change-consequences"
        "   # first check that no Actions log printed a secret",
        f"gh workflow enable agent-automerge.yml -R {repo}",
        "sed -i 's/^dry_run = false/dry_run = true/' ~/.config/roxira-merge-gate/merge_gate.toml"
        "   # as mahanfilms, so the gate does not race the merge queue",
        f"gh variable set CI_RUNNER_MODE -b hosted -R {repo}",
        "# then report on #592 what failed",
    ]


# ---- gh access --------------------------------------------------------------------------------------------------


class Gh:
    def __init__(self, repo: str = REPO):
        self.repo = repo

    def run(self, *args: str, check: bool = True) -> str:
        p = subprocess.run(["gh", *args], capture_output=True, text=True)
        if check and p.returncode != 0:
            raise RuntimeError(f"gh {' '.join(args[:3])} failed (exit {p.returncode}): {p.stderr.strip()[:200]}")
        return p.stdout

    def api(self, *args: str) -> str:
        return self.run("api", *args)

    def runner_mode(self) -> str | None:
        # gh 2.46 has no `gh variable get`: read the variable through the API (a missing one is a 404 = unset)
        p = subprocess.run(["gh", "api", f"repos/{self.repo}/actions/variables/CI_RUNNER_MODE", "-q", ".value"],
                           capture_output=True, text=True)
        return p.stdout.strip() or None if p.returncode == 0 else None

    def main_runs(self) -> list[dict]:
        out = self.api(
            f"repos/{self.repo}/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=50",
            "-q", "[.workflow_runs[]|{id,status,conclusion}]",
        )
        return json.loads(out)

    def run_jobs(self, run_id: int) -> list[dict]:
        out = self.api(
            f"repos/{self.repo}/actions/runs/{run_id}/jobs?per_page=100",
            "-q", "[.jobs[]|{name,conclusion,runner_name}]",
        )
        return json.loads(out)

    def is_private(self) -> bool:
        return self.api(f"repos/{self.repo}", "-q", ".private").strip() == "true"

    def label_exists(self, name: str) -> bool:
        p = subprocess.run(["gh", "api", f"repos/{self.repo}/labels/{name}", "-q", ".name"], capture_output=True, text=True)
        return p.returncode == 0 and p.stdout.strip() == name

    def workflow_state(self, wf: str) -> str:
        return self.api(f"repos/{self.repo}/actions/workflows/{wf}", "-q", ".state").strip()


def gather_prereqs(gh: Gh, gate_toml: Path) -> list[tuple[str, Result]]:
    res: list[tuple[str, Result]] = []
    try:
        res.append(("merge gate live", check_gate_live(gate_toml.read_text())))
    except OSError as e:
        res.append(("merge gate live", (False, f"cannot read gate config: {e.strerror}")))
    try:
        res.append(("CI_RUNNER_MODE set", check_runner_mode(gh.runner_mode())))
    except RuntimeError as e:
        res.append(("CI_RUNNER_MODE set", (False, str(e))))
    try:
        runs = gh.main_runs()
        jobs = {r["id"]: gh.run_jobs(r["id"]) for r in counted_runs(runs)}
        res.append(("last 3 main CI runs green on JIT", check_main_runs(runs, jobs)))
    except (RuntimeError, ValueError, KeyError) as e:
        res.append(("last 3 main CI runs green on JIT", (False, f"cannot read runs: {e}")))
    return res


# ---- steps ------------------------------------------------------------------------------------------------------


def say(msg: str) -> None:
    print(msg, flush=True)


def step_flip(gh: Gh, apply: bool) -> None:
    if not apply:
        say(f"  would run: gh api -X PATCH repos/{gh.repo} -F private=true")
        return
    if gh.is_private():
        say("  repo is already private, nothing to do")
        return
    gh.api("-X", "PATCH", f"repos/{gh.repo}", "-F", "private=true")
    if not gh.is_private():
        raise RuntimeError("PATCH returned but the repo is not private")
    say("  repo is private")


def step_disable_automerge(gh: Gh, apply: bool) -> None:
    wf = "agent-automerge.yml"
    if not apply:
        say(f"  would run: gh workflow disable {wf} -R {gh.repo}")
        return
    if gh.workflow_state(wf).startswith("disabled"):
        say(f"  {wf} already disabled")
        return
    gh.run("workflow", "disable", wf, "-R", gh.repo)
    say(f"  {wf} disabled")


def step_check_gate_label(gh: Gh, apply: bool, gate_toml: Path) -> Result:
    """Label exists + gate configured for it + one gate tick in --dry-run (log only) exits 0 with the live config."""
    try:
        gate_label = tomllib.loads(gate_toml.read_text()).get("label", "merge-queue")
    except (OSError, tomllib.TOMLDecodeError) as e:
        return False, f"cannot read gate config: {e}"
    ok, ev = label_state(gh.label_exists("merge-queue"), gate_label)
    if not ok and apply and gate_label == "merge-queue":
        # Without auto-merge on private Free the label is the only way to ask the gate for a merge: create it.
        gh.run("label", "create", "merge-queue", "-R", gh.repo, "--color", "0E8A16",
               "--description", "Ask the box merge gate to merge this PR", check=False)
        ok, ev = label_state(gh.label_exists("merge-queue"), gate_label)
    if not ok and not apply and gate_label == "merge-queue":
        return True, "label 'merge-queue' is missing in the repo: --apply creates it (the gate is configured for it)"
    if not ok:
        return ok, ev
    if not apply:
        return True, ev + "; the gate dry-run tick runs on --apply"
    tick = subprocess.run([sys.executable, str(GATE_PY), "--config", str(gate_toml), "--dry-run"],
                          capture_output=True, text=True)
    if tick.returncode != 0 or "tick failed" in tick.stderr:
        return False, f"gate dry-run tick failed (exit {tick.returncode})"
    return True, ev + "; gate dry-run tick ok"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Private flip of the repo (dry-run by default)")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--dry-run", action="store_true", help="verify prerequisites, print the plan (default)")
    g.add_argument("--apply", action="store_true", help="do the flip; refuses if any prerequisite fails")
    ap.add_argument("--owner-go", action="store_true", help="required with --apply: the owners said 'go private'")
    ap.add_argument("--repo", default=REPO)
    ap.add_argument("--gate-config", default=os.environ.get("MERGE_GATE_CONFIG", DEFAULT_GATE_TOML))
    args = ap.parse_args(argv)
    apply = args.apply
    gh = Gh(args.repo)
    gate_toml = Path(args.gate_config).expanduser()

    say(f"private flip of {gh.repo}: {'APPLY' if apply else 'dry-run'}")
    if apply and not args.owner_go:
        say("refused: --apply needs --owner-go (only the owners decide the flip, checklist section 0)")
        return 2

    say("1. prerequisites")
    ok, lines = evaluate_prereqs(gather_prereqs(gh, gate_toml))
    for ln in lines:
        say(ln)
    if not ok and apply:
        say("prerequisites FAILED; refusing --apply, nothing was changed")
        return 1
    if not ok:
        say("prerequisites FAILED (the plan below is what --apply would do once they pass)")

    try:
        say("2. flip to private")
        step_flip(gh, apply)
        say("3. disable agent-automerge.yml")
        step_disable_automerge(gh, apply)
        say("4. merge gate sees the merge-queue label")
        lok, lev = step_check_gate_label(gh, apply, gate_toml)
        say(f"  [{'ok' if lok else 'FAIL'}] {lev}")
        if not lok and apply:
            raise RuntimeError("merge gate label check failed after the flip")
    except RuntimeError as e:
        say(f"STOPPED: {e}")
        say("rollback commands (NOT run):")
        for c in rollback_commands(gh.repo):
            say(f"  {c}")
        return 1

    say("5. rollback commands (NOT run)")
    for c in rollback_commands(gh.repo):
        say(f"  {c}")
    say("done" if apply else "dry-run complete: nothing was changed")
    return 0 if (lok and ok) else 1


if __name__ == "__main__":
    sys.exit(main())
