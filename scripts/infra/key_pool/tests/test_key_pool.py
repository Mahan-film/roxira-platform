"""Offline tests for the key pool: no network, fake env only."""
from __future__ import annotations

import pathlib
import random
import sys

import pytest

HERE = pathlib.Path(__file__).resolve()
ROOT = HERE.parents[4]
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(ROOT / "scripts" / "dev"))

import keypool_config as kc
import llm_pool
import render_litellm

FAKE_ENV = {n: "fake-" + n.lower() for n in [
    "GROQ_API_KEY", "GROQ_API_KEY_2", "GROQ_API_KEY_3", "CEREBRAS_API_KEY", "SAMBANOVA_API_KEY",
    "MISTRAL_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "KEYPOOL_MASTER_KEY"]}


def pool():
    return kc.load_pool()


def test_render_shape_and_no_secret_values():
    cfg = render_litellm.render(pool(), set(FAKE_ENV))
    text = str(cfg)
    assert "fake-" not in text
    assert cfg["general_settings"]["master_key"] == "os.environ/KEYPOOL_MASTER_KEY"
    ag = [m for m in cfg["model_list"] if m["model_name"] == "agent-free"]
    groq = [m for m in ag if m["litellm_params"]["model"].startswith("groq/openai/gpt-oss-120b")]
    assert len(groq) == 3 and len({m["litellm_params"]["order"] for m in groq}) == 1
    assert all(m["litellm_params"]["api_key"].startswith("os.environ/") for m in ag)
    orders = [m["litellm_params"]["order"] for m in ag]
    assert orders == sorted(orders)
    assert ag[-1]["litellm_params"]["model"].startswith("openrouter/deepseek/")  # paid last
    assert cfg["router_settings"]["routing_strategy"] == "simple-shuffle"


def test_render_skips_providers_without_keys():
    cfg = render_litellm.render(pool(), {"GROQ_API_KEY", "KEYPOOL_MASTER_KEY"})
    models = {m["litellm_params"]["model"].split("/")[0] for m in cfg["model_list"]}
    assert models == {"groq"}


def test_private_group_has_no_free_or_may_log():
    deps = kc.group_deployments(pool(), "private", set(FAKE_ENV))
    assert deps
    for d in deps:
        assert d.data_policy == "no_train" and d.tier == "paid"
        assert not d.model.endswith(":free") and d.model != "openrouter/free"


def test_private_group_refuses_bad_config():
    p = pool()
    p["groups"]["private"]["providers"] = ["openrouter-free"]
    with pytest.raises(kc.PoolError):
        kc.group_deployments(p, "private", set(FAKE_ENV))
    p["groups"]["private"]["providers"] = ["groq"]
    p["groups"]["private"].pop("require")
    with pytest.raises(kc.PoolError):  # hard floor even without `require`
        kc.group_deployments(p, "private", set(FAKE_ENV))


def _post_factory(script):
    calls = []

    def post(url, headers, body, timeout):
        calls.append((url, body["model"]))
        host = url.split("/")[2]
        status = script.get(host, 200)
        data = {"choices": [{"message": {"content": "hello"}}]} if status == 200 else None
        return status, data
    return post, calls


def test_client_rotates_on_429_and_5xx_then_succeeds():
    post, calls = _post_factory({"api.groq.com": 429, "api.cerebras.ai": 503, "api.sambanova.ai": 0})
    text, used = llm_pool.chat([{"role": "user", "content": "hi"}], "agent-free", pool=pool(), env=FAKE_ENV,
                               post=post, rng=random.Random(1))
    assert text == "hello" and used.startswith("mistral/")
    hosts = [u.split("/")[2] for u, _ in calls]
    assert hosts[0] == "api.groq.com" and "api.mistral.ai" in hosts


def test_client_cooldown_skips_failed_provider():
    st = llm_pool.State(None)
    post, calls = _post_factory({"api.groq.com": 429})
    for _ in range(2):
        llm_pool.chat([{"role": "user", "content": "x"}], pool=pool(), env=FAKE_ENV, post=post,
                      state=st, rng=random.Random(2), now=lambda: 1000.0)
    groq_calls = [u for u, _ in calls if "groq" in u]
    assert len(groq_calls) == 3  # one attempt per Groq key; the second run skipped them all (cooldown)


def test_client_all_fail_raises():
    post, _ = _post_factory({h: 429 for h in [
        "api.groq.com", "api.cerebras.ai", "api.sambanova.ai", "api.mistral.ai",
        "generativelanguage.googleapis.com", "openrouter.ai"]})
    with pytest.raises(RuntimeError, match="all providers failed"):
        llm_pool.chat([{"role": "user", "content": "x"}], pool=pool(), env=FAKE_ENV, post=post)


def test_private_client_only_calls_paid_openrouter():
    post, calls = _post_factory({})
    llm_pool.chat([{"role": "user", "content": "x"}], "private", pool=pool(), env=FAKE_ENV, post=post)
    assert {u.split("/")[2] for u, _ in calls} == {"openrouter.ai"}
    assert not any(m.endswith(":free") for _, m in calls)
