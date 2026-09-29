"""Regression guard for the outage of 2026-09-20..29.

Daemon commit 2b605a1 deleted the citation-guard section of smartjudge_module.py
but left its call sites, so POST /api/v1/apps/judge/query crashed with NameError.
This offline test parses the module source (no imports, no network) and fails if
any of those definitions disappears again.
"""

import ast
import pathlib

MODULE = (
    pathlib.Path(__file__).resolve().parents[1]
    / "output_apps/generated_modules/smartjudge/smartjudge_module.py"
)

REQUIRED = {
    "_build_law_alias_index",
    "_resolve_law",
    "_canonical_citation",
    "CitationHallucinationGuard",
    "_citation_report_public",
    "_qdrant_citation_lookup",
    "_guard_citations",
    "verify_citations",
}


def _top_level_definitions() -> set:
    tree = ast.parse(MODULE.read_text(encoding="utf-8"))
    return {
        node.name
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
    }


def test_citation_guard_definitions_exist():
    missing = REQUIRED - _top_level_definitions()
    assert not missing, f"citation guard definitions missing: {sorted(missing)}"


def test_every_called_guard_name_is_defined():
    tree = ast.parse(MODULE.read_text(encoding="utf-8"))
    called = {
        node.func.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }
    guard_calls = {name for name in called if name in {"_guard_citations", "_citation_report_public"}}
    assert guard_calls, "expected call sites of the citation guard"
    assert guard_calls <= _top_level_definitions()
