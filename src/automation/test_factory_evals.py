"""Offline regression coverage for the Factory coding-eval corpus."""

import importlib.util
import json
from pathlib import Path

import pytest


TASKS_DIR = Path(__file__).resolve().parents[2] / "data" / "eval" / "factory_evals"


def _load_module(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def tasks():
    manifest = json.loads((TASKS_DIR / "manifest.json").read_text(encoding="utf-8"))
    return [TASKS_DIR / task["path"] for task in manifest["tasks"]]


def test_factory_references_pass_and_starters_fail_offline(tasks):
    for task_dir in tasks:
        checks = _load_module(task_dir / "checks.py")
        checks.run_checks(_load_module(task_dir / "reference_solution.py"))
        with pytest.raises(AssertionError):
            checks.run_checks(_load_module(task_dir / "starter.py"))
