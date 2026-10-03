"""Focused tests for scripts/ci/pin_actions.py (issue #365).

Pure logic only: ``resolve`` is a fake, so nothing touches the network or ``gh``.
The module lives under scripts/, outside pytest's ``testpaths = ["src"]``, so it
is loaded by file path here and never imported at collection time.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "ci" / "pin_actions.py"
SHA = "a" * 40


@pytest.fixture(scope="module")
def pin():
    spec = importlib.util.spec_from_file_location("pin_actions", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def fake(pin):
    def _resolve(owner_repo, ref):
        raise pin.ResolutionError(f"no mapping for {owner_repo}@{ref}")

    return _resolve


def _resolver(pin, mapping):
    def _resolve(owner_repo, ref):
        key = f"{owner_repo}@{ref}"
        if key not in mapping:
            raise pin.ResolutionError(f"no mapping for {key}")
        return mapping[key]

    return _resolve


def test_pins_mutable_tag(pin):
    text = "      - uses: actions/checkout@v7\n"
    result = pin.rewrite_text(text, _resolver(pin, {"actions/checkout@v7": SHA}))

    assert result.changed is True
    assert result.text == f"      - uses: actions/checkout@{SHA} # v7\n"
    assert result.unresolved == ()


def test_already_pinned_is_idempotent(pin):
    text = f"      - uses: actions/checkout@{SHA}\n"
    result = pin.rewrite_text(text, _resolver(pin, {}))

    assert result.changed is False
    assert result.text == text
    assert result.unresolved == ()


def test_local_and_docker_refs_are_untouched(pin):
    text = (
        "      - uses: ./local/action\n"
        "      - uses: docker://alpine:3.19\n"
    )
    result = pin.rewrite_text(text, _resolver(pin, {}))

    assert result.changed is False
    assert result.text == text


def test_existing_comment_is_preserved(pin):
    text = "        uses: actions/setup-python@v7  # keep this note\n"
    result = pin.rewrite_text(text, _resolver(pin, {"actions/setup-python@v7": SHA}))

    assert result.text == f"        uses: actions/setup-python@{SHA} # v7 keep this note\n"


def test_unresolved_ref_is_reported_and_line_unchanged(pin, fake):
    text = "        uses: actions/checkout@v7\n"
    result = pin.rewrite_text(text, fake)

    assert result.changed is False
    assert result.text == text
    assert result.unresolved == ("actions/checkout@v7",)


def test_path_in_action_uses_owner_repo(pin):
    calls = []

    def _resolve(owner_repo, ref):
        calls.append((owner_repo, ref))
        return SHA

    text = "        uses: github/codeql-action/upload-sarif@v3\n"
    result = pin.rewrite_text(text, _resolve)

    assert calls == [("github/codeql-action", "v3")]
    assert result.text == f"        uses: github/codeql-action/upload-sarif@{SHA} # v3\n"


def test_distinct_refs_resolve_once(pin):
    calls = []

    def _resolve(owner_repo, ref):
        calls.append((owner_repo, ref))
        return SHA

    text = "      - uses: actions/checkout@v7\n      - uses: actions/checkout@v7\n"
    pin.rewrite_text(text, _resolve)

    assert calls == [("actions/checkout", "v7")]


def test_dry_run_does_not_write_and_apply_does(pin, tmp_path):
    workflow = tmp_path / "ci.yml"
    workflow.write_text("      - uses: actions/checkout@v7\n", encoding="utf-8")
    resolver = _resolver(pin, {"actions/checkout@v7": SHA})

    changed, unresolved = pin.process_file(workflow, resolver, apply=False)
    assert changed is True
    assert unresolved == []
    assert workflow.read_text(encoding="utf-8") == "      - uses: actions/checkout@v7\n"

    changed, _ = pin.process_file(workflow, resolver, apply=True)
    assert changed is True
    assert workflow.read_text(encoding="utf-8") == f"      - uses: actions/checkout@{SHA} # v7\n"


def test_main_exits_nonzero_on_unresolved(pin, tmp_path, monkeypatch):
    workflows = tmp_path / "workflows"
    workflows.mkdir()
    (workflows / "ci.yml").write_text("      - uses: actions/checkout@v7\n", encoding="utf-8")

    monkeypatch.setattr(pin, "resolve", _resolver(pin, {}))
    assert pin.main([str(workflows)]) == 1

    monkeypatch.setattr(pin, "resolve", _resolver(pin, {"actions/checkout@v7": SHA}))
    assert pin.main([str(workflows)]) == 0
