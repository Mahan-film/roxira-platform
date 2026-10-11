"""Ruling/indictment drafting must not depend on LLM_ROUTER_ENABLED. Fakes only."""

import asyncio
import importlib

import pytest


@pytest.mark.parametrize("helper", ["_ruling_complete", "_indictment_complete"])
def test_draft_helpers_route_with_flag_off(monkeypatch, helper):
    mod = importlib.import_module("output_apps.generated_modules.smartjudge.smartjudge_module")
    monkeypatch.delenv("LLM_ROUTER_ENABLED", raising=False)
    monkeypatch.setattr(mod, "_use_llm_router", lambda: False)
    seen = {}

    class Routed:
        content = "پیش‌نویس"

    class FakeRouter:
        @staticmethod
        async def complete(tier, messages, **kw):
            seen["sensitive"] = kw.get("sensitive")
            return Routed()

    monkeypatch.setattr(mod, "_llm_router", FakeRouter)
    assert asyncio.run(getattr(mod, helper)("متن")) == "پیش‌نویس"
    assert seen["sensitive"] is True
