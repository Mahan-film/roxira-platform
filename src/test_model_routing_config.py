"""Guards for the routing section of config/models.yaml (tasks, chains, daily caps)."""

from __future__ import annotations

import pytest

from output_apps.generated_modules.smartjudge import model_registry as mr


def _is_free(model_id: str) -> bool:
    return model_id.endswith(":free") or model_id == "openrouter/free"


def test_every_task_chain_references_existing_roles():
    for name in mr.task_names():
        for role in mr.task(name)["chain"]:
            assert role in mr.all_role_names(), f"{name}: unknown role {role}"


def test_every_role_with_a_cap_exists_and_caps_are_non_negative():
    for role, cap in mr.budgets()["roles"].items():
        assert role in mr.all_role_names(), role
        assert cap >= 0


def test_global_cap_is_at_least_the_smallest_paid_role_cap():
    assert mr.global_daily_cap_usd() is not None
    assert mr.global_daily_cap_usd() > 0


def test_free_roles_have_zero_cap():
    assert mr.role_daily_cap_usd("free") == 0


def test_chain_is_free_first_then_paid():
    steps = mr.chain_for("assistant_chat", mode="test_accounts")
    ids = [s["id"] for s in steps]
    first_paid = next(i for i, m in enumerate(ids) if not _is_free(m))
    assert all(_is_free(m) for m in ids[:first_paid])
    assert all(not _is_free(m) for m in ids[first_paid:] if m not in ids[:first_paid])


def test_production_mode_drops_free_steps_for_tenant_data():
    steps = mr.chain_for("assistant_chat", mode="production")
    assert steps, "assistant_chat must keep a paid no_log path"
    assert not any(_is_free(s["id"]) for s in steps)


def test_public_factory_tasks_keep_free_steps_in_production():
    steps = mr.chain_for("selfimprove", mode="production")
    assert any(_is_free(s["id"]) for s in steps)


def test_data_class_can_only_get_stricter():
    steps = mr.chain_for("selfimprove", data_class="personal", mode="production")
    assert not any(_is_free(s["id"]) for s in steps)
    loose = mr.chain_for("assistant_chat", data_class="public", mode="production")
    assert not any(_is_free(s["id"]) for s in loose)  # stays tenant-business


def test_no_chain_contains_a_forbidden_id():
    for name in mr.task_names():
        for step in mr.chain_for(name, mode="test_accounts"):
            assert not mr.is_forbidden_model_id(step["id"])


def test_unknown_task_raises():
    with pytest.raises(mr.ModelRegistryError):
        mr.chain_for("nope")


@pytest.mark.parametrize("mode", ["test_accounts", "production"])
def test_every_task_keeps_at_least_one_step_in_every_mode(mode):
    for name in mr.task_names():
        assert mr.chain_for(name, mode=mode), f"{name} has no usable step in {mode} mode"


def test_every_role_that_can_spend_has_a_daily_cap():
    capped = mr.budgets()["roles"]
    for name in mr.task_names():
        for step in mr.chain_for(name, mode="test_accounts"):
            if not _is_free(step["id"]) and step["price_per_1m"]:
                assert step["role"] in capped, f"{name}: paid role {step['role']} has no cap"
