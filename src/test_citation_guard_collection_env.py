"""Offline test for the citation guard collection env override (issue #117)."""
import ast
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "output_apps/generated_modules/smartjudge/smartjudge_module.py"


def _load_helper():
    """Extract the pure helper without importing the heavy module."""
    tree = ast.parse(SRC.read_text(encoding="utf-8"))
    keep = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "_resolve_citation_collection":
            keep.append(node)
    from output_apps.generated_modules.smartjudge import served_collection

    ns = {"_served_collection": served_collection}
    exec(compile(ast.Module(body=keep, type_ignores=[]), str(SRC), "exec"), ns)  # noqa: S102
    return ns


def test_default_value():
    """T201: the default is the served collection (LIGHTRAG_QDRANT_COLLECTION), not a hardcoded name."""
    ns = _load_helper()
    served = {"LIGHTRAG_QDRANT_COLLECTION": "iran_laws_v8h"}
    assert ns["_resolve_citation_collection"](served) == "iran_laws_v8h"
    assert ns["_resolve_citation_collection"]({**served, "ROXIRA_CITATION_QDRANT_COLLECTION": "  "}) == "iran_laws_v8h"


def test_overridden_value():
    ns = _load_helper()
    env = {"ROXIRA_CITATION_QDRANT_COLLECTION": "iran_laws_v2"}
    assert ns["_resolve_citation_collection"](env) == "iran_laws_v2"
