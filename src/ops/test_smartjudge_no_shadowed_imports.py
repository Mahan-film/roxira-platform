"""Guard: no function in smartjudge_module.py re-imports a module-level alias.

A local `import ... as _regs` inside a function makes `_regs` local for the
whole function, so any use on a path that skipped that import raises
UnboundLocalError. That broke production chat on 2026-11-24 (PR #1385).
Static check only: the module is parsed, not imported.
"""

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "output_apps/generated_modules/smartjudge/smartjudge_module.py"


def _bound_names(node):
    for alias in node.names:
        yield (alias.asname or alias.name).split(".")[0]


def test_no_local_import_shadows_module_level_alias():
    tree = ast.parse(MODULE.read_text(encoding="utf-8"))
    top = {
        name
        for node in tree.body
        if isinstance(node, (ast.Import, ast.ImportFrom))
        for name in _bound_names(node)
    }
    offenders = []
    for fn in ast.walk(tree):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for node in ast.walk(fn):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                for name in _bound_names(node):
                    if name in top:
                        offenders.append(f"{fn.name}:{node.lineno} re-imports {name}")
    assert not offenders, "local imports shadow module-level names: " + "; ".join(offenders)
