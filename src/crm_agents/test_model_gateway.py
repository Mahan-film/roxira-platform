"""Unit tests for src/crm_agents/model_gateway.py (issue #368).

Pure unit tests: no network, no API key, no real model call (``send`` is a fake
and the registry is injected). Safe for ``pytest -m "not integration"``.
"""

from __future__ import annotations

import json

import pytest

from src.crm_agents.model_gateway import LaneViolation, call, choose_model, redact

REGISTRY = {
    "free": {"data_policy": "non_sensitive_only", "models": [{"id": "vendor/free-1"}]},
    "cheap": {"data_policy": "standard", "models": [{"id": "vendor/cheap-1"}]},
    "strong": {"data_policy": "standard", "models": [{"id": "vendor/strong-1"}]},
    "legacy": {"data_policy": "non_sensitive_only", "models": [{"id": "vendor/legacy-1"}]},
}


def test_free_customer_rejected():
    with pytest.raises(LaneViolation):
        choose_model("customer", "free", REGISTRY)


def test_non_sensitive_policy_customer_rejected_even_without_free_name():
    with pytest.raises(LaneViolation):
        choose_model("customer", "legacy", REGISTRY)


def test_cheap_customer_allowed():
    assert choose_model("customer", "cheap", REGISTRY) == "vendor/cheap-1"


def test_public_allowed_everywhere():
    for role, entry in REGISTRY.items():
        assert choose_model("public", role, REGISTRY) == entry["models"][0]["id"]


def test_unknown_role_raises():
    with pytest.raises(LaneViolation):
        choose_model("public", "does-not-exist", REGISTRY)


def test_unknown_data_class_raises():
    with pytest.raises(LaneViolation):
        choose_model("secret", "cheap", REGISTRY)


def test_choose_model_returns_first_model_id():
    assert choose_model("customer", "strong", REGISTRY) == "vendor/strong-1"


@pytest.mark.parametrize(
    "text",
    [
        "تماس با 09123456789",
        "تماس با +989123456789",
        "تماس با 00989123456789",
        "ایمیل ali@example.com",
        "کد ملی 1234567890",
        "کارت 1234567890123456",
        "کارت 1234 5678 9012 3456",
        "شماره ۰۹۱۲۳۴۵۶۷۸۹",
        "شماره ٠٩١٢٣٤٥٦٧٨٩",
        "کد ملی ۱۲۳۴۵۶۷۸۹۰",
        "کارت ۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶",
        "کارت ۱۲۳۴ ۵۶۷۸ ۹۰۱۲ ۳۴۵۶",
    ],
)
def test_redact_masks_each_pattern(text):
    out = redact(text)
    assert "[REDACTED]" in out
    assert "09123456789" not in out
    assert "1234567890" not in out
    assert "1234567890123456" not in out
    assert "ali@example.com" not in out


def test_redact_keeps_plain_text():
    assert redact("سلام، حال شما چطور است؟") == "سلام، حال شما چطور است؟"


def test_call_returns_send_output_and_passes_model_id():
    seen = {}

    def send(model_id, prompt):
        seen["model_id"] = model_id
        seen["prompt"] = prompt
        return "پاسخ"

    out = call(
        "متن",
        data_class="customer",
        role="cheap",
        send=send,
        registry=REGISTRY,
        log=lambda record: None,
    )
    assert out == "پاسخ"
    assert seen == {"model_id": "vendor/cheap-1", "prompt": "متن"}


def test_log_records_metadata_and_never_the_prompt():
    records = []
    secret = "SENSITIVE-CUSTOMER-TEXT 09123456789"
    call(
        secret,
        data_class="customer",
        role="strong",
        send=lambda model_id, prompt: "ok",
        registry=REGISTRY,
        log=records.append,
    )
    assert len(records) == 1
    record = records[0]
    assert set(record) == {
        "model_id",
        "role",
        "data_class",
        "prompt_sha256",
        "redacted_len",
    }
    assert "SENSITIVE-CUSTOMER-TEXT" not in json.dumps(record, ensure_ascii=False)
    assert record["model_id"] == "vendor/strong-1"
    assert record["role"] == "strong"
    assert record["data_class"] == "customer"
    assert isinstance(record["prompt_sha256"], str) and len(record["prompt_sha256"]) == 64
    assert record["redacted_len"] == len(redact(secret))


def test_persian_card_masked_in_original_text_only():
    assert redact("کارت ۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶ تمام") == "کارت [REDACTED] تمام"


def test_customer_data_never_reaches_free_lane_via_call():
    sent = []
    for registry in (REGISTRY, {"free": {"models": [{"id": "vendor/free-1"}]}}):
        with pytest.raises(LaneViolation):
            call(
                "customer text",
                data_class="customer",
                role="free",
                send=lambda model_id, prompt: sent.append(model_id) or "ok",
                registry=registry,
            )
    assert sent == []


def test_call_rejects_before_calling_send():
    calls = []
    with pytest.raises(LaneViolation):
        call(
            "customer text",
            data_class="customer",
            role="free",
            send=lambda model_id, prompt: calls.append(model_id) or "ok",
            registry=REGISTRY,
            log=lambda record: calls.append(record),
        )
    assert calls == []
