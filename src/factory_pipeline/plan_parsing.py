"""Turn a planner LLM response into a validated, dependency-ordered task list
and the GitHub child-issue payloads for each task (Project Factory stage 4).

`output_apps/ecosystem_core/src/factory/factory_plan.py` (run only from
`.github/workflows/factory-plan.yml`) asks a `strong`-tier model, via the
existing router (`src/automation/llm_router_bridge.call_llm`), to split one
approved brief+option into <= 15 small, independently testable tasks. Every
part of turning that response into issues that has no side effect lives here,
so it is unit tested with a canned LLM response instead of a real network
call: JSON extraction/validation, the dependency graph, build-order
resolution, PLAN.md rendering, and the exact issue title/body shape.

Expected planner JSON shape:
    {"tasks": [
        {"title": "...", "body_en": "...", "summary_fa": "...",
         "depends_on": [0, 2], "est_lines": 120},
        ...
    ]}
`depends_on` indices refer to other tasks' positions in this same list.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from src.automation.tech_radar import _extract_json

MAX_TASKS = 15


class PlanValidationError(ValueError):
    """The planner's JSON was structurally invalid: too many tasks, a bad
    `depends_on` index, a missing required field, or a dependency cycle. A
    human should never silently get issues opened from a plan like this."""


@dataclass(frozen=True)
class PlanTask:
    index: int  # 0-based position in the plan; the stable id `depends_on` refers to
    title: str
    body_en: str
    summary_fa: str
    depends_on: tuple[int, ...]
    est_lines: int | None = None


def parse_plan_response(raw_content: str) -> list[PlanTask]:
    """Extract and validate the planner's JSON payload into PlanTasks.

    Raises PlanValidationError for: not valid JSON / no "tasks" list, zero or
    more than MAX_TASKS tasks, a task missing title/body_en/summary_fa, a
    non-integer or out-of-range/self-referencing `depends_on` entry, or a
    dependency cycle.
    """
    parsed = _extract_json(raw_content or "")
    if not isinstance(parsed, dict) or not isinstance(parsed.get("tasks"), list):
        raise PlanValidationError("planner response is not valid JSON with a 'tasks' list")

    raw_tasks: list[Any] = parsed["tasks"]
    if not raw_tasks:
        raise PlanValidationError("planner returned zero tasks")
    if len(raw_tasks) > MAX_TASKS:
        raise PlanValidationError(f"planner returned {len(raw_tasks)} tasks, max is {MAX_TASKS}")

    tasks: list[PlanTask] = []
    for i, raw in enumerate(raw_tasks):
        if not isinstance(raw, dict):
            raise PlanValidationError(f"task {i} is not a JSON object")
        title = str(raw.get("title") or "").strip()
        body_en = str(raw.get("body_en") or "").strip()
        summary_fa = str(raw.get("summary_fa") or "").strip()
        if not title or not body_en or not summary_fa:
            raise PlanValidationError(
                f"task {i} is missing a required field (title/body_en/summary_fa)"
            )
        raw_deps = raw.get("depends_on") or []
        if not isinstance(raw_deps, list) or not all(
            isinstance(d, int) and not isinstance(d, bool) for d in raw_deps
        ):
            raise PlanValidationError(f"task {i} has a non-integer-list depends_on")
        deps = tuple(sorted(set(raw_deps)))
        for d in deps:
            if d == i or not (0 <= d < len(raw_tasks)):
                raise PlanValidationError(f"task {i} has an out-of-range depends_on index: {d}")
        raw_est = raw.get("est_lines")
        est_lines = (
            int(raw_est)
            if isinstance(raw_est, (int, float)) and not isinstance(raw_est, bool)
            else None
        )
        tasks.append(
            PlanTask(
                index=i,
                title=title,
                body_en=body_en,
                summary_fa=summary_fa,
                depends_on=deps,
                est_lines=est_lines,
            )
        )

    topological_order(tasks)  # raises PlanValidationError on a cycle; result unused here
    return tasks


def topological_order(tasks: list[PlanTask]) -> list[int]:
    """Return task indices ordered so every dependency comes before its
    dependents (stable: ties keep input order). Raises PlanValidationError on
    a cycle."""
    by_index = {t.index: t for t in tasks}
    state: dict[int, int] = {}  # 0 = visiting, 1 = done
    order: list[int] = []

    def visit(i: int) -> None:
        s = state.get(i)
        if s == 1:
            return
        if s == 0:
            raise PlanValidationError(f"dependency cycle involving task {i}")
        state[i] = 0
        for dep in by_index[i].depends_on:
            visit(dep)
        state[i] = 1
        order.append(i)

    for t in tasks:
        visit(t.index)
    return order


def render_plan_markdown(idea: str, option_name: str, tasks: list[PlanTask]) -> str:
    """PLAN.md content written to projects/<slug>/PLAN.md by factory_plan.py's PR."""
    order = topological_order(tasks)
    by_index = {t.index: t for t in tasks}
    lines = [
        f"# Project plan: {idea}",
        "",
        f"Approved stack option: **{option_name}**",
        "",
        f"{len(tasks)} task(s), dependency-resolved build order:",
        "",
    ]
    for pos, i in enumerate(order, start=1):
        t = by_index[i]
        deps = ", ".join(f"task {d}" for d in t.depends_on) or "none"
        lines.append(f"{pos}. **task {t.index}: {t.title}** (depends on: {deps})")
        if t.est_lines:
            lines.append(f"   - est. change size: ~{t.est_lines} lines")
        lines.append(f"   - {t.summary_fa}")
    lines.append("")
    return "\n".join(lines)


def task_issue_title(idea_slug: str, task: PlanTask) -> str:
    return f"[{idea_slug}] {task.title}"


def task_issue_body(task: PlanTask, parent_issue: int, dep_issue_numbers: dict[int, int]) -> str:
    """English body for the coding agent (agent_runner.build_prompt folds this
    into its prompt), plus a one-line Persian summary for the owner.

    `dep_issue_numbers` maps a plan task index to the real GitHub issue number
    created for it. Child issues are created in dependency order, so by the
    time task X's issue is opened, every task it depends on already has a
    real issue number to link; anything still missing (should not happen in
    the normal dependency-ordered creation path) falls back to naming the
    plan task index instead of crashing.
    """
    lines = [task.body_en, "", f"Parent issue: #{parent_issue}."]
    if task.depends_on:
        blockers = [
            f"#{dep_issue_numbers[d]}" if d in dep_issue_numbers else f"plan task {d}"
            for d in task.depends_on
        ]
        lines.append(f"Blocked by: {', '.join(blockers)}. Do not start until those merge.")
    lines.append("")
    lines.append(f"خلاصه فارسی: {task.summary_fa}")
    return "\n".join(lines)


def ready_tasks(
    tasks: list[PlanTask], done_indices: set[int], in_progress_indices: set[int]
) -> list[PlanTask]:
    """Tasks not already done/in-progress whose dependencies are all done,
    in plan order. The dispatcher (factory_dispatch_next.py) takes as many of
    these as its concurrency budget allows."""
    ready = []
    for t in tasks:
        if t.index in done_indices or t.index in in_progress_indices:
            continue
        if all(d in done_indices for d in t.depends_on):
            ready.append(t)
    return ready
