"""Unit tests for output_apps/generated_modules/smartjudge/model_registry.py (W12).

model_registry.py lives under output_apps/, outside pytest's `testpaths = ["src"]`
(see pyproject.toml), so it is loaded dynamically inside a fixture rather than
imported at module level — see src/factory/test_agent_runner.py for the same
pattern and src/ci_quarantine.py for why module-level side effects in a
src/test_*.py file are forbidden.

No network, no API key, no LLM call: pure parsing of a YAML file.
"""

from __future__ import annotations

import importlib.util
import textwrap
from pathlib import Path

import pytest

model_registry = None  # populated by _load_model_registry() before any test runs


@pytest.fixture(scope="session", autouse=True)
def _load_model_registry():
    global model_registry
    if model_registry is None:
        module_path = (
            Path(__file__).resolve().parents[1]
            / "output_apps"
            / "generated_modules"
            / "smartjudge"
            / "model_registry.py"
        )
        spec = importlib.util.spec_from_file_location("model_registry", module_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        model_registry = module


@pytest.fixture
def sample_registry(tmp_path) -> Path:
    path = tmp_path / "models.yaml"
    path.write_text(
        textwrap.dedent(
            """\
            schema_version: 1
            roles:
              free:
                description: test free role
                data_policy: non_sensitive_only
                models:
                  - id: vendor-a/model-1:free
                    price_per_1m: { in: 0, out: 0 }
                  - id: vendor-b/model-2:free
                    price_per_1m: { in: 0, out: 0 }
              cheap:
                description: test cheap role
                data_policy: standard
                models:
                  - id: vendor-c/model-3
                    price_per_1m: { in: 0.1, out: 0.5 }
            """
        ),
        encoding="utf-8",
    )
    return path


def test_role_models_returns_ordered_ids(sample_registry):
    assert model_registry.role_models("free", sample_registry) == [
        "vendor-a/model-1:free",
        "vendor-b/model-2:free",
    ]
    assert model_registry.role_models("cheap", sample_registry) == ["vendor-c/model-3"]


def test_role_entries_carries_price(sample_registry):
    entries = model_registry.role_entries("cheap", sample_registry)
    assert entries[0]["id"] == "vendor-c/model-3"
    assert entries[0]["price_per_1m"] == {"in": 0.1, "out": 0.5}


def test_data_policy(sample_registry):
    assert model_registry.data_policy("free", sample_registry) == "non_sensitive_only"
    assert model_registry.data_policy("cheap", sample_registry) == "standard"


def test_unknown_role_raises(sample_registry):
    with pytest.raises(model_registry.ModelRegistryError):
        model_registry.role_models("does-not-exist", sample_registry)


def test_missing_file_raises(tmp_path):
    with pytest.raises(model_registry.ModelRegistryError):
        model_registry.role_models("free", tmp_path / "nope.yaml")


def test_malformed_yaml_raises(tmp_path):
    path = tmp_path / "bad.yaml"
    path.write_text("not: a: valid: mapping: [", encoding="utf-8")
    with pytest.raises(model_registry.ModelRegistryError):
        model_registry.roles(path)


def test_missing_roles_key_raises(tmp_path):
    path = tmp_path / "no_roles.yaml"
    path.write_text("schema_version: 1\n", encoding="utf-8")
    with pytest.raises(model_registry.ModelRegistryError):
        model_registry.roles(path)


def test_all_role_names(sample_registry):
    assert set(model_registry.all_role_names(sample_registry)) == {"free", "cheap"}


def test_real_registry_file_parses_and_has_required_roles():
    """The actual config/models.yaml in the repo must parse and cover every
    role llm_router.py / provider_base.py / opencode.json rely on."""
    real_path = (
        Path(__file__).resolve().parents[1] / "config" / "models.yaml"
    )
    names = set(model_registry.all_role_names(real_path))
    required = {
        "free", "cheap", "strong", "stt", "tts",
        "architect", "executor", "reviewer", "mechanical",
    }
    assert required.issubset(names)
    for role in ("free", "cheap", "strong", "executor", "reviewer"):
        models = model_registry.role_models(role, real_path)
        assert models, f"role {role!r} has no models configured"


def test_customer_data_never_routes_to_free_tier():
    """docs/STRATEGY.md §3b hard rule, encoded as a registry-shape check."""
    real_path = (
        Path(__file__).resolve().parents[1] / "config" / "models.yaml"
    )
    assert model_registry.data_policy("free", real_path) == "non_sensitive_only"


def test_reviewer_has_a_different_model_family_from_executor_primary():
    """W12 spec, relaxed 2026-10-10: the reviewer list must contain at least one
    model from a different family than the executor primary. DeepSeek stays in
    the reviewer fallback chain by owner priority order."""
    real_path = (
        Path(__file__).resolve().parents[1] / "config" / "models.yaml"
    )
    def family(model_id: str) -> str:
        return model_id.split("/", 1)[0]

    executor = model_registry.role_models("executor", real_path)
    reviewer = model_registry.role_models("reviewer", real_path)
    assert any(family(m) != family(executor[0]) for m in reviewer)


# --- 2026-10-10 owner policy: Gemini Pro ban, :free only for public code -----

def test_no_role_contains_a_gemini_pro_id():
    """Owner policy (2026-10-10): Gemini Pro is forbidden everywhere."""
    real_path = Path(__file__).resolve().parents[1] / "config" / "models.yaml"
    # Read the raw YAML: role_models() already skips forbidden ids, so using it here
    # would pass even if config/models.yaml still listed one.
    for role, role_data in model_registry.roles(real_path).items():
        for entry in (role_data or {}).get("models", []) or []:
            model_id = str(entry.get("id", ""))
            assert not model_registry.is_forbidden_model_id(model_id), (role, model_id)


def test_gemini_pro_ids_are_skipped_at_load_time(tmp_path, caplog):
    path = tmp_path / "models.yaml"
    path.write_text(
        textwrap.dedent(
            """\
            schema_version: 1
            roles:
              cheap:
                data_policy: standard
                models:
                  - id: google/gemini-2.5-pro
                    price_per_1m: { in: 1, out: 1 }
                  - id: google/gemini-3.1-flash-lite
                    price_per_1m: { in: 0.25, out: 1.50 }
            """
        ),
        encoding="utf-8",
    )
    with caplog.at_level("WARNING"):
        assert model_registry.role_models("cheap", path) == ["google/gemini-3.1-flash-lite"]
    assert "gemini" in caplog.text.lower()


def test_no_sensitive_role_contains_a_free_model():
    """Owner policy + AGENTS.md §4: `:free` ids may only appear in non-sensitive roles.
    Sensitive roles carry customer/case data (chat, legal drafts, voice)."""
    real_path = Path(__file__).resolve().parents[1] / "config" / "models.yaml"
    sensitive = ("cheap", "strong", "stt", "tts", "voice_realtime")

    def is_free_model(model_id: str) -> bool:
        return model_id.endswith(":free") or model_id == "openrouter/free"

    for role in sensitive:
        models = model_registry.role_models(role, real_path)
        assert not any(is_free_model(m) for m in models), role


def test_free_reviewer_entries_are_marked_public_code_only():
    """A `:free` reviewer entry may only see public-repo code/docs."""
    real_path = Path(__file__).resolve().parents[1] / "config" / "models.yaml"
    for entry in model_registry.role_entries("reviewer", real_path):
        if entry["id"].endswith(":free"):
            assert entry.get("public_code_only") is True, entry["id"]


# --- W24 (cost-optimized product-runtime models, docs/STATE.md) ------------

def test_cheap_role_primary_is_deepseek_v4_1_flash():
    """Owner decision (2026-09-28): every website chat turn, free and paid
    plans alike, must try DeepSeek V4.1 Flash first."""
    real_path = Path(__file__).resolve().parents[1] / "config" / "models.yaml"
    models = model_registry.role_models("cheap", real_path)
    assert models[0] == "deepseek/deepseek-v4.1-flash"


def test_strong_role_priority_order_and_no_sonnet():
    """Owner decision (2026-09-28): DeepSeek V4 Pro, then GLM-5.3, then
    Kimi K3, then Gemini 3.8 Flash -- and no anthropic/claude-sonnet-5
    anywhere in the product runtime (it stays only in builder roles)."""
    real_path = Path(__file__).resolve().parents[1] / "config" / "models.yaml"
    models = model_registry.role_models("strong", real_path)
    assert models == [
        "deepseek/deepseek-v4-pro",
        "z-ai/glm-5.3",
        "moonshotai/kimi-k3",
        "google/gemini-3.8-flash",
    ]
    assert "anthropic/claude-sonnet-5" not in models


def test_no_product_runtime_role_uses_claude_sonnet():
    """anthropic/claude-sonnet-5 may only appear in builder roles
    (architect/executor/reviewer/mechanical), never in free/cheap/strong."""
    real_path = Path(__file__).resolve().parents[1] / "config" / "models.yaml"
    for role in ("free", "cheap", "strong"):
        models = model_registry.role_models(role, real_path)
        assert "anthropic/claude-sonnet-5" not in models, role


def test_no_product_runtime_role_routes_case_data_to_a_free_model():
    """Hard rule (AGENTS.md §4): customer/case data never goes to a `:free`
    model. Only the `free` role (non-sensitive-only background work) may
    contain `:free`-suffixed or `openrouter/free` ids; cheap/strong (which
    carry customer chat/legal-draft data) must never."""
    real_path = Path(__file__).resolve().parents[1] / "config" / "models.yaml"

    def is_free_model(model_id: str) -> bool:
        return model_id.endswith(":free") or model_id == "openrouter/free"

    for role in ("cheap", "strong"):
        models = model_registry.role_models(role, real_path)
        assert not any(is_free_model(m) for m in models), role
        assert model_registry.data_policy(role, real_path) == "standard"


# --- runtime guard: models_for(role, sensitive) ----------------------------

def test_models_for_non_sensitive_matches_role_models(sample_registry):
    assert model_registry.models_for("free", False, sample_registry) == [
        "vendor-a/model-1:free",
        "vendor-b/model-2:free",
    ]
    assert model_registry.models_for("cheap", False, sample_registry) == ["vendor-c/model-3"]


def test_models_for_sensitive_drops_public_code_only_and_free_ids(tmp_path):
    path = tmp_path / "models.yaml"
    path.write_text(
        textwrap.dedent(
            """\
            schema_version: 1
            roles:
              reviewer:
                data_policy: standard
                models:
                  - id: vendor-a/public-only:free
                    price_per_1m: { in: 0, out: 0 }
                    public_code_only: true
                  - id: vendor-b/unmarked:free
                    price_per_1m: { in: 0, out: 0 }
                  - id: openrouter/free
                    price_per_1m: { in: 0, out: 0 }
                  - id: vendor-c/paid
                    price_per_1m: { in: 0.3, out: 1.0 }
                  - id: vendor-d/paid-2
                    price_per_1m: { in: 0.3, out: 1.0 }
            """
        ),
        encoding="utf-8",
    )
    assert model_registry.models_for("reviewer", True, path) == ["vendor-c/paid", "vendor-d/paid-2"]
    assert model_registry.models_for("reviewer", False, path) == [
        "vendor-a/public-only:free",
        "vendor-b/unmarked:free",
        "openrouter/free",
        "vendor-c/paid",
        "vendor-d/paid-2",
    ]


def test_models_for_sensitive_real_reviewer_has_no_public_code_only_entry():
    real_path = Path(__file__).resolve().parents[1] / "config" / "models.yaml"
    public_only = {
        e["id"] for e in model_registry.role_entries("reviewer", real_path)
        if e.get("public_code_only") is True
    }
    assert public_only, "expected the reviewer role to carry a public_code_only entry"
    sensitive = model_registry.models_for("reviewer", True, real_path)
    assert not public_only & set(sensitive)
    assert not any(m.endswith(":free") for m in sensitive)
    assert model_registry.models_for("reviewer", False, real_path) == model_registry.role_models(
        "reviewer", real_path
    )


def test_models_for_unknown_role_raises(sample_registry):
    with pytest.raises(model_registry.ModelRegistryError):
        model_registry.models_for("does-not-exist", True, sample_registry)


def test_every_free_entry_outside_free_role_is_public_code_only():
    """Extends the reviewer check: any `:free` id in a non-`free` role (reviewer,
    builder roles, product tiers) must carry public_code_only: true."""
    real_path = Path(__file__).resolve().parents[1] / "config" / "models.yaml"
    for role, role_data in model_registry.roles(real_path).items():
        if role == "free":
            continue
        for entry in (role_data or {}).get("models", []) or []:
            model_id = str(entry.get("id", ""))
            if model_id.endswith(":free") or model_id == "openrouter/free":
                # Single owner exception (AGENTS.md section 4, 2026-10-14): the last rung of the
                # VIP `drafting` ladder, see test_drafting_role_ladder_shape.
                if entry.get("last_resort_free") is True:
                    assert role == "drafting", (role, model_id)
                    continue
                assert entry.get("public_code_only") is True, (role, model_id)


def test_drafting_role_ladder_shape():
    """VIP drafts: paid DeepSeek V4 Pro, then V4.1 Flash, the free model strictly LAST and flagged."""
    real_path = Path(__file__).resolve().parents[1] / "config" / "models.yaml"
    entries = model_registry.role_entries("drafting", real_path)
    ids = [e["id"] for e in entries]
    assert ids[:2] == ["deepseek/deepseek-v4-pro", "deepseek/deepseek-v4.1-flash"]
    free = [e for e in entries if e["id"].endswith(":free")]
    assert [e["id"] for e in free] == [ids[-1]] and free[0].get("last_resort_free") is True
    assert len(ids) == 3
    # sensitive callers using the generic registry helper still never see the :free id
    assert model_registry.models_for("drafting", True, real_path) == ids[:2]
