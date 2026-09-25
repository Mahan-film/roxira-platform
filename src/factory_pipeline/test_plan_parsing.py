from __future__ import annotations

import json

import pytest

from src.factory_pipeline.plan_parsing import (
    MAX_TASKS,
    PlanTask,
    PlanValidationError,
    parse_plan_response,
    ready_tasks,
    render_plan_markdown,
    task_issue_body,
    task_issue_title,
    topological_order,
)


def _plan_json(tasks: list[dict]) -> str:
    return json.dumps({"tasks": tasks})


def _task(title="T", body_en="do it", summary_fa="خلاصه", depends_on=None, est_lines=None):
    d = {"title": title, "body_en": body_en, "summary_fa": summary_fa}
    if depends_on is not None:
        d["depends_on"] = depends_on
    if est_lines is not None:
        d["est_lines"] = est_lines
    return d


# ---------------------------------------------------------------------------
# parse_plan_response
# ---------------------------------------------------------------------------


def test_parse_valid_plan():
    raw = _plan_json([_task("Set up DB schema"), _task("Add API endpoint", depends_on=[0])])
    tasks = parse_plan_response(raw)
    assert len(tasks) == 2
    assert tasks[0].title == "Set up DB schema"
    assert tasks[1].depends_on == (0,)


def test_parse_strips_markdown_fences():
    raw = "```json\n" + _plan_json([_task()]) + "\n```"
    tasks = parse_plan_response(raw)
    assert len(tasks) == 1


def test_parse_finds_json_embedded_in_prose():
    raw = "Here is the plan:\n" + _plan_json([_task()]) + "\nHope that helps!"
    tasks = parse_plan_response(raw)
    assert len(tasks) == 1


def test_parse_rejects_non_json():
    with pytest.raises(PlanValidationError, match="not valid JSON"):
        parse_plan_response("not json at all")


def test_parse_rejects_missing_tasks_key():
    with pytest.raises(PlanValidationError, match="not valid JSON"):
        parse_plan_response(json.dumps({"foo": "bar"}))


def test_parse_rejects_zero_tasks():
    with pytest.raises(PlanValidationError, match="zero tasks"):
        parse_plan_response(_plan_json([]))


def test_parse_rejects_too_many_tasks():
    tasks = [_task(f"T{i}") for i in range(MAX_TASKS + 1)]
    with pytest.raises(PlanValidationError, match="max is"):
        parse_plan_response(_plan_json(tasks))


def test_parse_allows_exactly_max_tasks():
    tasks = [_task(f"T{i}") for i in range(MAX_TASKS)]
    assert len(parse_plan_response(_plan_json(tasks))) == MAX_TASKS


def test_parse_rejects_missing_required_field():
    raw = _plan_json([{"title": "Only a title"}])
    with pytest.raises(PlanValidationError, match="missing a required field"):
        parse_plan_response(raw)


def test_parse_rejects_non_object_task():
    raw = json.dumps({"tasks": ["not an object"]})
    with pytest.raises(PlanValidationError, match="not a JSON object"):
        parse_plan_response(raw)


def test_parse_rejects_non_integer_depends_on():
    raw = _plan_json([_task(depends_on=["zero"])])
    with pytest.raises(PlanValidationError, match="non-integer-list depends_on"):
        parse_plan_response(raw)


def test_parse_rejects_self_dependency():
    raw = _plan_json([_task(depends_on=[0])])
    with pytest.raises(PlanValidationError, match="out-of-range depends_on"):
        parse_plan_response(raw)


def test_parse_rejects_out_of_range_dependency():
    raw = _plan_json([_task(depends_on=[5])])
    with pytest.raises(PlanValidationError, match="out-of-range depends_on"):
        parse_plan_response(raw)


def test_parse_rejects_dependency_cycle():
    raw = _plan_json([_task("A", depends_on=[1]), _task("B", depends_on=[0])])
    with pytest.raises(PlanValidationError, match="cycle"):
        parse_plan_response(raw)


def test_parse_dedupes_and_sorts_depends_on():
    raw = _plan_json([_task(), _task(), _task("C", depends_on=[1, 0, 1])])
    tasks = parse_plan_response(raw)
    assert tasks[2].depends_on == (0, 1)


def test_parse_est_lines_optional_and_coerced():
    raw = _plan_json([_task(est_lines=150.0)])
    tasks = parse_plan_response(raw)
    assert tasks[0].est_lines == 150

    raw_missing = _plan_json([_task()])
    assert parse_plan_response(raw_missing)[0].est_lines is None


# ---------------------------------------------------------------------------
# topological_order
# ---------------------------------------------------------------------------


def test_topological_order_respects_dependencies():
    tasks = [
        PlanTask(0, "A", "b", "f", ()),
        PlanTask(1, "B", "b", "f", (0,)),
        PlanTask(2, "C", "b", "f", (1,)),
    ]
    order = topological_order(tasks)
    assert order.index(0) < order.index(1) < order.index(2)


def test_topological_order_independent_tasks_keep_stable_order():
    tasks = [PlanTask(0, "A", "b", "f", ()), PlanTask(1, "B", "b", "f", ())]
    assert topological_order(tasks) == [0, 1]


def test_topological_order_diamond_dependency():
    # 0 -> 1, 0 -> 2, {1,2} -> 3
    tasks = [
        PlanTask(0, "A", "b", "f", ()),
        PlanTask(1, "B", "b", "f", (0,)),
        PlanTask(2, "C", "b", "f", (0,)),
        PlanTask(3, "D", "b", "f", (1, 2)),
    ]
    order = topological_order(tasks)
    assert order.index(0) < order.index(1)
    assert order.index(0) < order.index(2)
    assert order.index(1) < order.index(3)
    assert order.index(2) < order.index(3)


# ---------------------------------------------------------------------------
# render_plan_markdown / issue title & body
# ---------------------------------------------------------------------------


def test_render_plan_markdown_contains_idea_and_option():
    tasks = [PlanTask(0, "Set up DB", "b", "خلاصه", ())]
    md = render_plan_markdown("My Idea", "NestJS + Postgres", tasks)
    assert "My Idea" in md
    assert "NestJS + Postgres" in md
    assert "Set up DB" in md
    assert "خلاصه" in md


def test_task_issue_title_includes_slug_and_title():
    task = PlanTask(0, "Add login", "b", "f", ())
    assert task_issue_title("voice-app", task) == "[voice-app] Add login"


def test_task_issue_body_no_dependencies():
    task = PlanTask(0, "Add login", "Implement login.", "پیاده‌سازی ورود", ())
    body = task_issue_body(task, parent_issue=10, dep_issue_numbers={})
    assert "Implement login." in body
    assert "Parent issue: #10." in body
    assert "Blocked by" not in body
    assert "پیاده‌سازی ورود" in body


def test_task_issue_body_with_known_dependency_issue_numbers():
    task = PlanTask(1, "Add login", "Implement login.", "f", (0,))
    body = task_issue_body(task, parent_issue=10, dep_issue_numbers={0: 42})
    assert "Blocked by: #42." in body


def test_task_issue_body_with_unresolved_dependency_falls_back_to_task_index():
    task = PlanTask(1, "Add login", "Implement login.", "f", (0,))
    body = task_issue_body(task, parent_issue=10, dep_issue_numbers={})
    assert "Blocked by: plan task 0." in body


# ---------------------------------------------------------------------------
# ready_tasks
# ---------------------------------------------------------------------------


def test_ready_tasks_no_dependencies_all_ready():
    tasks = [PlanTask(0, "A", "b", "f", ()), PlanTask(1, "B", "b", "f", ())]
    assert [t.index for t in ready_tasks(tasks, set(), set())] == [0, 1]


def test_ready_tasks_blocked_by_unfinished_dependency():
    tasks = [PlanTask(0, "A", "b", "f", ()), PlanTask(1, "B", "b", "f", (0,))]
    assert [t.index for t in ready_tasks(tasks, set(), set())] == [0]


def test_ready_tasks_unblocked_once_dependency_done():
    tasks = [PlanTask(0, "A", "b", "f", ()), PlanTask(1, "B", "b", "f", (0,))]
    assert [t.index for t in ready_tasks(tasks, {0}, set())] == [1]


def test_ready_tasks_excludes_done_and_in_progress():
    tasks = [
        PlanTask(0, "A", "b", "f", ()),
        PlanTask(1, "B", "b", "f", ()),
        PlanTask(2, "C", "b", "f", ()),
    ]
    ready = ready_tasks(tasks, done_indices={0}, in_progress_indices={1})
    assert [t.index for t in ready] == [2]
