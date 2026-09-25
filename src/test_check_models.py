"""Unit tests for scripts/check_models.py (W12).

scripts/check_models.py lives outside pytest's `testpaths = ["src"]`, so it is
loaded dynamically in a fixture — same pattern as src/factory/test_agent_runner.py
and src/test_model_registry.py.

Fully offline: uses a fake catalogue dict and a temp config/models.yaml. No
network call, no OPENROUTER_API_KEY needed or read.
"""

from __future__ import annotations

import importlib.util
import textwrap
from pathlib import Path

import pytest

check_models = None  # populated by _load_check_models() before any test runs


@pytest.fixture(scope="session", autouse=True)
def _load_check_models():
    global check_models
    if check_models is None:
        module_path = Path(__file__).resolve().parents[1] / "scripts" / "check_models.py"
        spec = importlib.util.spec_from_file_location("check_models", module_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        check_models = module


@pytest.fixture
def registry_path(tmp_path) -> Path:
    path = tmp_path / "models.yaml"
    path.write_text(
        textwrap.dedent(
            """\
            schema_version: 1
            roles:
              cheap:
                description: test
                data_policy: standard
                models:
                  - id: vendor/still-live
                    price_per_1m: { in: 0.1, out: 0.2 }
                  - id: vendor/retired-fallback
                    price_per_1m: { in: 0.3, out: 0.4 }
              strong:
                description: test
                data_policy: standard
                models:
                  - id: vendor/retired-primary
                    price_per_1m: { in: 1.0, out: 2.0 }
              tts:
                description: test
                data_policy: standard
                models:
                  - id: edge-tts:fa-IR-FaridNeural
                    price_per_1m: { in: 0, out: 0 }
            """
        ),
        encoding="utf-8",
    )
    return path


@pytest.fixture
def catalogue():
    # OpenRouter pricing is USD per token; _per_1m() below multiplies by 1e6.
    return {
        "vendor/still-live": {"prompt": 0.1 / 1_000_000, "completion": 0.2 / 1_000_000},
        # "vendor/retired-fallback" deliberately absent -> MISSING, non-primary.
        # "vendor/retired-primary" deliberately absent -> MISSING, primary.
    }


def test_ok_model_reports_ok(registry_path, catalogue):
    rows, _ = check_models.check(registry_path, catalogue)
    live = next(r for r in rows if r["id"] == "vendor/still-live")
    assert live["status"] == "ok"
    assert live["live_price_per_1m"] == {"in": 0.1, "out": 0.2}


def test_missing_primary_fails(registry_path, catalogue):
    rows, has_primary_failure = check_models.check(registry_path, catalogue)
    primary = next(r for r in rows if r["id"] == "vendor/retired-primary")
    assert primary["status"] == "MISSING"
    assert primary["primary"] is True
    assert has_primary_failure is True


def test_missing_fallback_does_not_fail_by_itself(registry_path, catalogue):
    # Swap in a catalogue where the primary IS live but a fallback is missing.
    cat = dict(catalogue)
    cat["vendor/retired-primary"] = {"prompt": 1.0 / 1_000_000, "completion": 2.0 / 1_000_000}
    rows, has_primary_failure = check_models.check(registry_path, cat)
    assert has_primary_failure is False
    fallback = next(r for r in rows if r["id"] == "vendor/retired-fallback")
    assert fallback["status"] == "MISSING"
    assert fallback["primary"] is False
    assert has_primary_failure is False


def test_price_drift_is_reported(registry_path, catalogue):
    cat = dict(catalogue)
    cat["vendor/still-live"] = {"prompt": 5.0 / 1_000_000, "completion": 6.0 / 1_000_000}
    rows, _ = check_models.check(registry_path, cat)
    live = next(r for r in rows if r["id"] == "vendor/still-live")
    assert live["status"] == "PRICE"
    assert live["live_price_per_1m"] == {"in": 5.0, "out": 6.0}


def test_non_openrouter_id_is_skipped_not_missing(registry_path, catalogue):
    rows, _ = check_models.check(registry_path, catalogue)
    tts = next(r for r in rows if r["id"] == "edge-tts:fa-IR-FaridNeural")
    assert tts["status"] == "skipped"


def test_index_catalogue_parses_openrouter_shape():
    data = {
        "data": [
            {"id": "a/b", "pricing": {"prompt": "0.0000001", "completion": "0.0000002"}},
            {"id": "c/d", "pricing": {}},
            {"no_id": True},
        ]
    }
    out = check_models._index_catalogue(data)
    assert out["a/b"] == {"prompt": 1e-7, "completion": 2e-7}
    assert out["c/d"] == {"prompt": 0.0, "completion": 0.0}
    assert "no_id" not in out
    assert len(out) == 2


def test_main_offline_mode_exits_nonzero_on_missing_primary(registry_path, catalogue, tmp_path):
    import json

    offline_file = tmp_path / "catalogue.json"
    offline_file.write_text(
        json.dumps(
            {
                "data": [
                    {
                        "id": mid,
                        "pricing": {"prompt": v["prompt"], "completion": v["completion"]},
                    }
                    for mid, v in catalogue.items()
                ]
            }
        ),
        encoding="utf-8",
    )
    code = check_models.main(
        ["--offline", str(offline_file), "--registry", str(registry_path), "--json"]
    )
    assert code == 1


def test_main_offline_mode_exits_zero_when_everything_matches(tmp_path):
    import json

    registry = tmp_path / "models.yaml"
    registry.write_text(
        textwrap.dedent(
            """\
            schema_version: 1
            roles:
              cheap:
                description: test
                data_policy: standard
                models:
                  - id: vendor/only
                    price_per_1m: { in: 1.0, out: 2.0 }
            """
        ),
        encoding="utf-8",
    )
    offline_file = tmp_path / "catalogue.json"
    offline_file.write_text(
        json.dumps(
            {"data": [{"id": "vendor/only", "pricing": {"prompt": 1e-6, "completion": 2e-6}}]}
        ),
        encoding="utf-8",
    )
    code = check_models.main(["--offline", str(offline_file), "--registry", str(registry)])
    assert code == 0
