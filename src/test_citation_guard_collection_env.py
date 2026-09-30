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
        elif isinstance(node, ast.Assign) and any(
            getattr(t, "id", "") == "CITATION_QDRANT_COLLECTION_DEFAULT" for t in node.targets
        ):
            keep.append(node)
    ns = {"os": __import__("os")}
    exec(compile(ast.Module(body=keep, type_ignores=[]), str(SRC), "exec"), ns)  # noqa: S102
    return ns


def test_default_value():
    ns = _load_helper()
    assert ns["_resolve_citation_collection"]({}) == "iran_laws_bge_m3"
    assert ns["_resolve_citation_collection"]({"ROXIRA_CITATION_QDRANT_COLLECTION": "  "}) == "iran_laws_bge_m3"


def test_overridden_value():
    ns = _load_helper()
    env = {"ROXIRA_CITATION_QDRANT_COLLECTION": "iran_laws_v2"}
    assert ns["_resolve_citation_collection"](env) == "iran_laws_v2"
