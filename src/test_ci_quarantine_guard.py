"""Keeps src/ci_quarantine.py honest.

Every test_*.py under src/ must either be free of import-time side effects (so pytest can
collect it safely) or be listed in the quarantine. Pure AST checks: nothing is imported.
"""

from __future__ import annotations

import ast
import importlib.util
from pathlib import Path

SRC = Path(__file__).resolve().parent
SKIP_DIRS = {"venv", "node_modules", "__pycache__"}
SAFE_NODES = (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
# Calls allowed in module-level assignments: pure path/container construction.
PURE_CALLS = {"Path", "resolve", "with_name", "joinpath", "set", "frozenset", "tuple", "dict"}


def _call_name(call: ast.Call) -> str:
    func = call.func
    return func.id if isinstance(func, ast.Name) else getattr(func, "attr", "")


def _load_quarantine():
    spec = importlib.util.spec_from_file_location("ci_quarantine", SRC / "ci_quarantine.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _test_files() -> list[str]:
    return sorted(
        p.relative_to(SRC).as_posix()
        for p in SRC.rglob("test_*.py")
        if not SKIP_DIRS.intersection(p.parts)
    )


def _is_safe_statement(node: ast.stmt) -> bool:
    if isinstance(node, SAFE_NODES):
        return True
    if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
        return True  # docstring
    if isinstance(node, ast.If) and "__name__" in ast.unparse(node.test):
        return True  # if __name__ == "__main__":
    if isinstance(node, ast.Assign | ast.AnnAssign):
        value = node.value
        nodes = ast.walk(value) if value is not None else ()
        return all(_call_name(n) in PURE_CALLS for n in nodes if isinstance(n, ast.Call))
    return False


def _has_import_side_effects(path: Path) -> bool:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except SyntaxError:
        return True
    return not all(_is_safe_statement(node) for node in tree.body)


def test_quarantined_files_exist():
    missing = [f for f in _load_quarantine().IGNORED if not (SRC / f).is_file()]
    assert not missing, f"Remove these from src/ci_quarantine.py: {missing}"


def test_new_side_effect_scripts_are_quarantined():
    ignored = set(_load_quarantine().IGNORED)
    unlisted = [f for f in _test_files() if f not in ignored and _has_import_side_effects(SRC / f)]
    assert not unlisted, (
        "These test files run code at import time. Turn the code into test functions, "
        f"or add them to SCRIPTS in src/ci_quarantine.py: {unlisted}"
    )


def test_safe_statement_detection():
    assert _is_safe_statement(ast.parse("import os").body[0])
    assert _is_safe_statement(ast.parse("X = 1").body[0])
    assert _is_safe_statement(ast.parse("ROOT = Path(__file__).resolve().parent").body[0])
    assert not _is_safe_statement(ast.parse("engine = Engine()").body[0])
    assert not _is_safe_statement(ast.parse("print('x')").body[0])
