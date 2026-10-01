#!/usr/bin/env python3
"""Coding smoke eval (W12 follow-up, docs/STRATEGY.md §3a).

STRATEGY.md §3a says a model in config/models.yaml is only swapped if "the
evals (W6 legal eval, one coding smoke task) do not regress". scripts/eval_legal_rag.py
covers the legal eval; this script is the coding half: a small, cheap set of
self-contained Python tasks (data/eval/coding_smoke/) sent one at a time to a
candidate model over OpenRouter, graded by running each task's hidden pytest
checks against the code the model returns.

Usage:
    # Single model, human-readable report on stdout.
    python3 scripts/eval_coding_smoke.py --model deepseek/deepseek-v4-flash-0731

    # Several models, one report each.
    python3 scripts/eval_coding_smoke.py --models deepseek/deepseek-v4-flash-0731,qwen/qwen3-coder

    # Compare a candidate against a role's current registry primary and gate on it
    # (this is what .github/workflows/model-eval.yml calls).
    python3 scripts/eval_coding_smoke.py --compare --role executor \\
        --candidate deepseek/deepseek-v4-flash --max-usd 0.50

    # No network, no key: canned reference-solution responses (used by CI/tests).
    python3 scripts/eval_coding_smoke.py --model any/id --offline

Auth: reads OPENROUTER_API_KEY or OPENROUTER_AGENT_KEY from the environment.
Never hardcode a key; --offline needs neither.

Grading: the candidate model's code is extracted from its response, written
to solution.py in a fresh temp dir alongside the task's hidden checks.py (as
test_checks.py), and run with `pytest` in a subprocess with a timeout and a
best-effort network-restricted environment (see `_restricted_env`) -- this is
NOT a real sandbox (no seccomp/namespaces), just a safety net against an
accidental network call or a runaway loop from generated code.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from output_apps.generated_modules.smartjudge import model_registry  # noqa: E402

OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"
CHAT_URL = OPENROUTER_CHAT_URL
DEFAULT_TASKS_DIR = ROOT / "data" / "eval" / "coding_smoke"
DEFAULT_MAX_USD = 0.50
DEFAULT_CHECK_TIMEOUT_S = 10.0
DEFAULT_CALL_TIMEOUT_S = 60.0

SYSTEM_PROMPT = (
    "You are a careful Python engineer completing a small, self-contained coding task. "
    "Respond with EXACTLY one fenced Python code block (```python ... ```) containing the "
    "full contents of the requested file. No prose before or after the code block."
)

_CODE_BLOCK_RE = re.compile(r"```(?:python)?\s*\n(.*?)```", re.DOTALL)


# ---------------------------------------------------------------------------
# Task loading
# ---------------------------------------------------------------------------


@dataclass
class Task:
    id: str
    title: str
    entry_filename: str
    timeout_s: float
    prompt: str
    starter_code: str
    checks_code: str
    reference_solution: str


def load_manifest(tasks_dir: pathlib.Path) -> list[dict[str, Any]]:
    manifest_path = tasks_dir / "manifest.json"
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    return data["tasks"]


def load_tasks(tasks_dir: pathlib.Path = DEFAULT_TASKS_DIR) -> list[Task]:
    tasks = []
    for entry in load_manifest(tasks_dir):
        task_dir = tasks_dir / "tasks" / entry["id"]
        tasks.append(
            Task(
                id=entry["id"],
                title=entry["title"],
                entry_filename=entry.get("entry_filename", "solution.py"),
                timeout_s=float(entry.get("timeout_s", DEFAULT_CHECK_TIMEOUT_S)),
                prompt=(task_dir / "prompt.md").read_text(encoding="utf-8"),
                starter_code=(task_dir / "starter.py").read_text(encoding="utf-8"),
                checks_code=(task_dir / "checks.py").read_text(encoding="utf-8"),
                reference_solution=(task_dir / "reference_solution.py").read_text(encoding="utf-8"),
            )
        )
    return tasks


# ---------------------------------------------------------------------------
# Code extraction
# ---------------------------------------------------------------------------


def extract_code(response_text: str) -> str | None:
    """Pull the first fenced code block out of a model response. Returns None
    if no fenced block is present (the run is graded as a failure, not a
    crash)."""
    match = _CODE_BLOCK_RE.search(response_text)
    if not match:
        return None
    return match.group(1).strip("\n") + "\n"


def build_task_prompt(task: Task) -> str:
    return (
        f"{task.prompt}\n\n"
        f"Starter file (`{task.entry_filename}`) to complete or fix:\n"
        f"```python\n{task.starter_code}\n```\n"
    )


# ---------------------------------------------------------------------------
# Model call
# ---------------------------------------------------------------------------


def call_model(
    prompt: str,
    api_key: str,
    model: str,
    timeout: float = DEFAULT_CALL_TIMEOUT_S,
) -> tuple[str | None, dict[str, Any]]:
    """POST to OpenRouter chat completions. Returns (raw_response_text_or_None,
    usage_dict). Never raises for a network/parse failure -- returns
    (None, {"error": ...}) instead so a single bad call doesn't abort the
    whole eval run."""
    body = json.dumps(
        {
            "model": model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0,
        }
    ).encode("utf-8")
    req = urllib.request.Request(CHAT_URL, data=body, method="POST")
    req.add_header("Authorization", f"Bearer {api_key}")
    req.add_header("Content-Type", "application/json")

    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        return None, {
            "error": f"{type(exc).__name__}: {exc}",
            "latency_ms": (time.time() - t0) * 1000.0,
        }

    latency_ms = (time.time() - t0) * 1000.0
    try:
        content = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return None, {"error": f"no message content: {payload!r}", "latency_ms": latency_ms}

    usage_raw = payload.get("usage") or {}
    usage = {
        "model": payload.get("model", model),
        "prompt_tokens": usage_raw.get("prompt_tokens"),
        "completion_tokens": usage_raw.get("completion_tokens"),
        # OpenRouter reports cost in credits; 1 credit == 1 USD (same convention
        # as llm_router.py's _usage_record and review_gate.py).
        "cost_usd": float(usage_raw.get("cost")) if "cost" in usage_raw else None,
        "latency_ms": latency_ms,
    }
    return content, usage


def _call_with_deadline(
    prompt: str, api_key: str, model: str, deadline_s: float = DEFAULT_CALL_TIMEOUT_S * 2
) -> tuple[str | None, dict[str, Any]]:
    """call_model() with a hard wall-clock deadline. urllib's timeout only bounds
    each socket read, so a provider that trickles bytes can hold a call open
    for tens of minutes (seen on the first live executor eval). A daemon thread
    is used so an abandoned call cannot keep the process alive at exit."""
    box: dict[str, Any] = {}

    def _run() -> None:
        box["result"] = call_model(prompt, api_key, model)

    worker = threading.Thread(target=_run, daemon=True)
    worker.start()
    worker.join(deadline_s)
    if "result" in box:
        return box["result"]
    return None, {"error": f"deadline {deadline_s:.0f}s exceeded", "latency_ms": deadline_s * 1000}


def price_for_model(model_id: str) -> dict[str, float] | None:
    """Look up price_per_1m for a model id anywhere in config/models.yaml
    (searches every role), for estimating cost when OpenRouter's response
    doesn't include a `usage.cost` field."""
    try:
        data = model_registry.load()
    except model_registry.ModelRegistryError:
        return None
    for role_data in data.get("roles", {}).values():
        for entry in role_data.get("models", []):
            if entry.get("id") == model_id and entry.get("price_per_1m"):
                return entry["price_per_1m"]
    return None


def estimate_cost_usd(usage: dict[str, Any], model_id: str) -> float:
    if usage.get("cost_usd") is not None:
        return float(usage["cost_usd"])
    price = price_for_model(model_id)
    if not price:
        return 0.0
    prompt_tokens = usage.get("prompt_tokens") or 0
    completion_tokens = usage.get("completion_tokens") or 0
    return (prompt_tokens / 1_000_000.0) * price.get("in", 0.0) + (
        completion_tokens / 1_000_000.0
    ) * price.get("out", 0.0)


# ---------------------------------------------------------------------------
# Check execution (subprocess, timeout, best-effort network restriction)
# ---------------------------------------------------------------------------


def _restricted_env() -> dict[str, str]:
    """Environment for the pytest subprocess that runs a task's hidden checks.

    Best-effort only -- this is not a real sandbox (no seccomp/namespaces/
    firewall). It strips every credential-shaped variable from the parent
    environment and points the common proxy variables at a port nothing
    listens on, so a generated solution that tries `requests.get(...)`
    fails fast on a connection error instead of silently reaching the
    network with this process's own keys.
    """
    keep = {"PATH", "PYTHONPATH", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "HOME"}
    env = {k: v for k, v in os.environ.items() if k in keep}
    env["HTTP_PROXY"] = env["HTTPS_PROXY"] = "http://127.0.0.1:1"
    env["http_proxy"] = env["https_proxy"] = "http://127.0.0.1:1"
    env["NO_PROXY"] = env["no_proxy"] = ""
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return env


@dataclass
class CheckResult:
    passed: bool
    detail: str


def run_checks(code: str | None, task: Task) -> CheckResult:
    if code is None:
        return CheckResult(passed=False, detail="no code block found in model response")

    with tempfile.TemporaryDirectory(prefix="coding_smoke_") as tmp:
        tmp_path = pathlib.Path(tmp)
        (tmp_path / task.entry_filename).write_text(code, encoding="utf-8")
        (tmp_path / "test_checks.py").write_text(task.checks_code, encoding="utf-8")

        try:
            proc = subprocess.run(
                [sys.executable, "-m", "pytest", "test_checks.py", "-q", "--no-header"],
                cwd=tmp_path,
                env=_restricted_env(),
                timeout=task.timeout_s,
                capture_output=True,
                text=True,
            )
        except subprocess.TimeoutExpired:
            return CheckResult(passed=False, detail=f"checks timed out after {task.timeout_s}s")

        if proc.returncode == 0:
            return CheckResult(passed=True, detail="ok")
        tail = "\n".join((proc.stdout + proc.stderr).splitlines()[-15:])
        return CheckResult(passed=False, detail=tail)


# ---------------------------------------------------------------------------
# Eval run
# ---------------------------------------------------------------------------


@dataclass
class TaskRunResult:
    task_id: str
    passed: bool
    detail: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms: float = 0.0
    skipped_budget: bool = False


@dataclass
class EvalSummary:
    model: str
    n_tasks: int
    n_passed: int
    pass_rate: float
    total_cost_usd: float
    total_tokens: int
    avg_latency_ms: float
    results: list[TaskRunResult] = field(default_factory=list)
    budget_exhausted: bool = False


def _canned_response_for(task: Task) -> str:
    """--offline: a deterministic "response" containing the task's own
    reference solution, wrapped the way a real model reply would be. Used so
    the harness (extraction, grading, reporting) can be exercised with no
    network and no API key."""
    return f"```python\n{task.reference_solution}```\n"


def run_eval(
    model: str,
    tasks: list[Task],
    api_key: str | None,
    max_usd: float = DEFAULT_MAX_USD,
    offline: bool = False,
) -> EvalSummary:
    results: list[TaskRunResult] = []
    cumulative_cost = 0.0
    budget_exhausted = False

    for task in tasks:
        if not offline and cumulative_cost >= max_usd:
            budget_exhausted = True
            results.append(
                TaskRunResult(
                    task_id=task.id,
                    passed=False,
                    detail="skipped: --max-usd budget reached",
                    skipped_budget=True,
                )
            )
            continue

        if offline:
            content = _canned_response_for(task)
            usage: dict[str, Any] = {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "cost_usd": 0.0,
                "latency_ms": 0.0,
            }
        else:
            prompt = build_task_prompt(task)
            print(f"[{model}] {task.id}: calling...", file=sys.stderr, flush=True)
            content, usage = _call_with_deadline(prompt, api_key or "", model)
            print(
                f"[{model}] {task.id}: {'ok' if content is not None else usage.get('error')} "
                f"({usage.get('latency_ms', 0):.0f} ms)",
                file=sys.stderr,
                flush=True,
            )

        if content is None:
            error = usage.get("error", "unknown error")
            results.append(
                TaskRunResult(task_id=task.id, passed=False, detail=f"model call failed: {error}")
            )
            continue

        code = extract_code(content)
        check_result = run_checks(code, task)

        cost = estimate_cost_usd(usage, model) if not offline else 0.0
        cumulative_cost += cost

        results.append(
            TaskRunResult(
                task_id=task.id,
                passed=check_result.passed,
                detail=check_result.detail,
                prompt_tokens=usage.get("prompt_tokens") or 0,
                completion_tokens=usage.get("completion_tokens") or 0,
                cost_usd=cost,
                latency_ms=usage.get("latency_ms") or 0.0,
            )
        )

    n_tasks = len(results)
    n_passed = sum(1 for r in results if r.passed)
    total_tokens = sum(r.prompt_tokens + r.completion_tokens for r in results)
    total_cost = sum(r.cost_usd for r in results)
    latencies = [r.latency_ms for r in results if r.latency_ms]
    avg_latency = sum(latencies) / len(latencies) if latencies else 0.0

    return EvalSummary(
        model=model,
        n_tasks=n_tasks,
        n_passed=n_passed,
        pass_rate=round(n_passed / n_tasks, 4) if n_tasks else 0.0,
        total_cost_usd=round(total_cost, 6),
        total_tokens=total_tokens,
        avg_latency_ms=round(avg_latency, 1),
        results=results,
        budget_exhausted=budget_exhausted,
    )


# ---------------------------------------------------------------------------
# Compare / gate
# ---------------------------------------------------------------------------


def gate_passes(
    candidate_pass_rate: float,
    primary_pass_rate: float,
    candidate_cost_usd: float,
    primary_cost_usd: float,
    cost_multiplier: float = 1.5,
) -> bool:
    """The swap gate from docs/STRATEGY.md §3a: the candidate's pass rate must
    be at least the role primary's, and -- unless its pass rate is strictly
    higher -- its cost must be no more than `cost_multiplier`x the primary's.

    A primary pass rate of 0 or a primary cost of 0 are handled without
    dividing by zero: a strictly higher candidate pass rate always waives the
    cost check, and if the primary's cost is 0 the candidate must also cost
    (essentially) 0 to pass on cost alone.
    """
    if candidate_pass_rate < primary_pass_rate:
        return False
    if candidate_pass_rate > primary_pass_rate:
        return True
    if primary_cost_usd <= 0:
        return candidate_cost_usd <= 1e-9
    return candidate_cost_usd <= cost_multiplier * primary_cost_usd


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def summary_to_dict(summary: EvalSummary) -> dict[str, Any]:
    return {
        "model": summary.model,
        "n_tasks": summary.n_tasks,
        "n_passed": summary.n_passed,
        "pass_rate": summary.pass_rate,
        "total_cost_usd": summary.total_cost_usd,
        "total_tokens": summary.total_tokens,
        "avg_latency_ms": summary.avg_latency_ms,
        "budget_exhausted": summary.budget_exhausted,
        "failures": [
            {"task_id": r.task_id, "detail": r.detail} for r in summary.results if not r.passed
        ],
    }


def print_text_summary(summary: EvalSummary) -> None:
    print(f"\n=== {summary.model} ===")
    print(f"  pass rate     : {summary.n_passed}/{summary.n_tasks} ({summary.pass_rate:.0%})")
    print(f"  total cost    : ${summary.total_cost_usd:.4f}")
    print(f"  total tokens  : {summary.total_tokens}")
    print(f"  avg latency   : {summary.avg_latency_ms:.0f} ms")
    if summary.budget_exhausted:
        print("  NOTE: --max-usd budget was reached before all tasks ran")
    for r in summary.results:
        if not r.passed:
            first_line = r.detail.splitlines()[0] if r.detail else ""
            print(f"  FAIL {r.task_id}: {first_line}")


def print_compare_table(summaries: list[EvalSummary], file=None) -> None:
    header = f"{'model':45} {'pass':>8} {'cost($)':>10} {'tokens':>8} {'latency(ms)':>12}"
    print(header, file=file)
    print("-" * len(header), file=file)
    for s in summaries:
        print(
            f"{s.model:45} {s.n_passed}/{s.n_tasks:>5} {s.total_cost_usd:>10.4f} "
            f"{s.total_tokens:>8} {s.avg_latency_ms:>12.0f}",
            file=file,
        )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    global CHAT_URL
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--model", default=None, help="single OpenRouter model id to evaluate")
    ap.add_argument("--models", default=None, help="comma-separated OpenRouter model ids")
    ap.add_argument("--base-url", default=None, help="OpenAI-compatible API base URL")
    ap.add_argument("--api-key-env", default=None, help="environment variable containing the API key")
    ap.add_argument(
        "--compare",
        action="store_true",
        help="compare --candidate against --role's registry primary and gate on it",
    )
    ap.add_argument(
        "--role",
        default=None,
        help="config/models.yaml role whose primary model is the baseline (--compare)",
    )
    ap.add_argument("--candidate", default=None, help="candidate model id (--compare)")
    ap.add_argument(
        "--max-usd",
        type=float,
        default=DEFAULT_MAX_USD,
        help="stop calling the model once this run's cumulative cost reaches this many USD",
    )
    ap.add_argument(
        "--offline",
        action="store_true",
        help="use canned reference-solution responses; no network call, no API key needed",
    )
    ap.add_argument("--tasks-dir", type=pathlib.Path, default=DEFAULT_TASKS_DIR)
    ap.add_argument(
        "--json", action="store_true", help="print machine-readable JSON instead of a text report"
    )
    args = ap.parse_args(argv)
    if args.base_url:
        CHAT_URL = args.base_url.rstrip("/") + "/chat/completions"

    tasks = load_tasks(args.tasks_dir)

    api_key = os.environ.get(args.api_key_env, "").strip() if args.api_key_env else (
        os.environ.get("OPENROUTER_API_KEY", "").strip()
        or os.environ.get("OPENROUTER_AGENT_KEY", "").strip()
    )
    if not args.offline and not api_key:
        key_source = args.api_key_env or "OPENROUTER_API_KEY or OPENROUTER_AGENT_KEY"
        print(
            f"error: no API key found. Set {key_source}, "
            "or pass --offline to run with canned responses.",
            file=sys.stderr,
        )
        return 2

    if args.compare:
        if not args.role or not args.candidate:
            print("error: --compare requires --role and --candidate", file=sys.stderr)
            return 2
        try:
            primary_id = model_registry.role_entries(args.role)[0]["id"]
        except (model_registry.ModelRegistryError, IndexError) as exc:
            print(
                f"error: could not resolve primary model for role {args.role!r}: {exc}",
                file=sys.stderr,
            )
            return 2

        model_ids = [primary_id] if primary_id == args.candidate else [primary_id, args.candidate]
        summaries = {m: run_eval(m, tasks, api_key, args.max_usd, args.offline) for m in model_ids}

        primary_summary = summaries[primary_id]
        candidate_summary = summaries.get(args.candidate, primary_summary)

        # In --json mode stdout must be pure JSON (the workflow pipes it to jq),
        # so the human-readable table and gate line go to stderr instead.
        text_out = sys.stderr if args.json else sys.stdout
        print_compare_table(list(summaries.values()), file=text_out)

        passed = gate_passes(
            candidate_summary.pass_rate,
            primary_summary.pass_rate,
            candidate_summary.total_cost_usd,
            primary_summary.total_cost_usd,
        )
        verdict = "PASS" if passed else "FAIL"
        print(
            f"\nGATE: {verdict} -- candidate={args.candidate} (role={args.role}, "
            f"primary={primary_id})\n"
            f"  candidate pass_rate={candidate_summary.pass_rate:.0%} "
            f"cost=${candidate_summary.total_cost_usd:.4f}\n"
            f"  primary   pass_rate={primary_summary.pass_rate:.0%} "
            f"cost=${primary_summary.total_cost_usd:.4f}",
            file=text_out,
        )

        if args.json:
            print(
                json.dumps(
                    {
                        "gate": verdict,
                        "role": args.role,
                        "primary": summary_to_dict(primary_summary),
                        "candidate": summary_to_dict(candidate_summary),
                    },
                    indent=2,
                )
            )
        return 0 if passed else 1

    if args.models:
        model_ids = [m.strip() for m in args.models.split(",") if m.strip()]
    elif args.model:
        model_ids = [args.model]
    else:
        print("error: pass --model, --models, or --compare", file=sys.stderr)
        return 2

    summaries = [run_eval(m, tasks, api_key, args.max_usd, args.offline) for m in model_ids]

    if args.json:
        print(json.dumps([summary_to_dict(s) for s in summaries], indent=2))
    else:
        for s in summaries:
            print_text_summary(s)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
