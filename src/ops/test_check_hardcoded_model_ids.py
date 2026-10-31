"""Focused tests for the hardcoded-model-id checker."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


@pytest.fixture
def checker():
    spec = importlib.util.spec_from_file_location(
        "check_hardcoded_model_ids",
        Path(__file__).resolve().parents[2] / "scripts/ci/check_hardcoded_model_ids.py",
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_counts_quoted_vendor_ids(checker):
    text = 'a = "deepseek/deepseek-v4.1-flash"\nb = \'nvidia/nemotron-3-ultra:free\'\nc = "foo/bar"'
    assert checker.count_ids(text) == 2


def test_ignores_paths_and_urls(checker):
    assert checker.count_ids('p = "google/quic"\nu = "https://openai.com/x"') == 1  # google/quic only
    assert checker.count_ids("see deepseek/deepseek-v4 in a comment") == 0


def test_scope(checker):
    assert checker.in_scope("output_apps/generated_modules/x/mod.py")
    assert not checker.in_scope("config/models.yaml")
    assert not checker.in_scope("docs/a.py")
    assert not checker.in_scope("src/foo/test_bar.py")
    assert not checker.in_scope("output_apps/enterprise_hub/modules/a/a.service.spec.ts")
    assert not checker.in_scope("README.md")


def test_repo_has_no_new_hardcoded_ids(checker):
    counts = checker.scan(checker.tracked_files())
    baseline = checker.load_baseline()
    new = {p: n for p, n in counts.items() if n > baseline.get(p, 0)}
    assert not new, f"new hardcoded model ids (use config/models.yaml): {new}"
