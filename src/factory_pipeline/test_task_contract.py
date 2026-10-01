import pytest

from src.factory_pipeline.plan_parsing import PlanValidationError
from src.factory_pipeline.task_contract import TaskContract, parallel_safe, parse_contract, paths_overlap


def raw_contract(**changes):
    contract = {"area": "backend", "allowed_paths": ["src/api"],
                "needs_migration": False, "test_command": "pytest tests"}
    contract.update(changes)
    return {"contract": contract}


def test_parse_contract():
    assert parse_contract(raw_contract()).allowed_paths == ("src/api",)
    for raw in ({}, raw_contract(area="x"), raw_contract(allowed_paths=["../x"]),
                raw_contract(allowed_paths=["/abs"]), raw_contract(allowed_paths=["data/x"])):
        with pytest.raises(PlanValidationError):
            parse_contract(raw)


def test_paths_overlap_is_segment_aware():
    app = TaskContract("backend", ("src/app",), False, "test")
    child = TaskContract("backend", ("src/app/x",), False, "test")
    application = TaskContract("backend", ("src/application",), False, "test")
    assert paths_overlap(app, child)
    assert not paths_overlap(app, application)


def test_parallel_safe():
    first = TaskContract("database", ("db/a",), True, "test")
    second = TaskContract("database", ("db/b",), True, "test")
    ui = TaskContract("frontend", ("src/ui",), False, "test")
    docs = TaskContract("docs", ("docs/x",), False, "test")
    assert not parallel_safe([first, second])
    assert parallel_safe([ui, docs])
