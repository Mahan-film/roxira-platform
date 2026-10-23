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
    "GROQ_API_KEY", "GROQ_API_KEY_2", "GROQ_API_KEY_3", "SAMBANOVA_API_KEY",
    "MISTRAL_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "KEYPOOL_MASTER_KEY"]}


def pool():
    return kc.load_pool()


def test_render_shape_and_no_secret_values():
    cfg = render_litellm.render(pool(), set(FAKE_ENV))
    text = str(cfg)
    assert "fake-" not in text
    assert cfg["general_settings"]["master_key"] == "os.environ/KEYPOOL_MASTER_KEY"
    strong = [m for m in cfg["model_list"] if m["model_name"] == "agent-strong-free"]
    groq = [m for m in strong if m["litellm_params"]["model"].startswith("groq/openai/gpt-oss-120b")]
    assert len(groq) == 3
    assert all(m["litellm_params"]["api_key"].startswith("os.environ/") for m in strong)
    assert all("order" not in m["litellm_params"] for m in cfg["model_list"])  # providers reject it
    assert all(m["model_info"]["tier"] == "free" for m in strong)  # paid only via fallback
    light = [m for m in cfg["model_list"] if m["model_name"] == "agent-light-free"]
    assert light and all(m["model_info"]["tier"] == "free" for m in light)
    paid = [m for m in cfg["model_list"] if m["model_name"] == "agent-free-paid"]
    assert paid and paid[0]["litellm_params"]["model"] == "openrouter/z-ai/glm-5.3-flash"  # cheap agent step: GLM Flash first
    paid2 = [m for m in cfg["model_list"] if m["model_name"] == "agent-free-paid__r2"]
    assert paid2 and all(m["litellm_params"]["model"] == "openrouter/deepseek/deepseek-v4.1-flash" for m in paid2)
    fb = {k: v for f in cfg["router_settings"]["fallbacks"] for k, v in f.items()}
    assert fb["agent-strong-free"] == ["gemini-best"]  # Gemini ladder before paid DeepSeek (owner 2026-10-16)
    assert fb["agent-light-free"] == ["agent-strong-free", "agent-free-paid"]
    assert fb["agent-free"] == ["agent-free-paid"]
    assert cfg["router_settings"]["routing_strategy"] == "simple-shuffle"


def test_strong_and_light_tiers_do_not_mix_models():
    cfg = render_litellm.render(pool(), set(FAKE_ENV))

    def models(name):
        return {m["litellm_params"]["model"] for m in cfg["model_list"] if m["model_name"] == name}

    strong, light = models("agent-strong-free"), models("agent-light-free")
    assert strong.isdisjoint(light)
    assert "groq/openai/gpt-oss-120b" in strong and "groq/openai/gpt-oss-20b" in light
    assert "sambanova/gpt-oss-120b" in strong
    assert "gemini/gemini-flash-latest" in strong and "gemini/gemini-3.7-flash" in strong
    assert "mistral/mistral-small-latest" in light
    assert any(m.endswith("nemotron-3-ultra-550b-a55b:free") for m in strong)
    assert any(m.endswith("nemotron-3-super-120b-a12b:free") for m in light)
    assert any(m.endswith("gemma-4-31b-it:free") for m in light)
    assert any(m.endswith("nemotron-3.5-lightning:free") for m in light)


def test_agent_free_is_strong_alias():
    cfg = render_litellm.render(pool(), set(FAKE_ENV))

    def models(name):
        return sorted(m["litellm_params"]["model"] for m in cfg["model_list"] if m["model_name"] == name)

    assert models("agent-free") == models("agent-strong-free")


def test_render_router_settings_and_per_key_limits():
    cfg = render_litellm.render(pool(), set(FAKE_ENV))
    router = cfg["router_settings"]
    assert router["routing_strategy"] == "simple-shuffle"
    assert (router["num_retries"], router["allowed_fails"], router["cooldown_time"]) == (1, 1, 60)  # num_retries, allowed_fails, cooldown (2026-10-16: skip busy models at once)
    groq = [m for m in cfg["model_list"]
            if m["model_name"] == "agent-strong-free"
            and m["litellm_params"]["model"] == "groq/openai/gpt-oss-120b"]
    assert len(groq) == 3
    assert all(m["litellm_params"].get("rpm") == 30 and m["litellm_params"].get("tpm") == 8000 for m in groq)


def test_render_skips_providers_without_keys():
    cfg = render_litellm.render(pool(), {"GROQ_API_KEY", "KEYPOOL_MASTER_KEY"})
    models = {m["litellm_params"]["model"].split("/")[0]
              for m in cfg["model_list"] if m["model_name"] != "embeddings"}
    assert models == {"groq"}


def test_embeddings_group_renders_local_tei_without_secret():
    cfg = render_litellm.render(pool(), set(FAKE_ENV))
    emb = [m for m in cfg["model_list"] if m["model_name"] == "embeddings"]
    assert len(emb) == 1
    params = emb[0]["litellm_params"]
    assert params["model"] == "openai/bge-m3"
    assert params["api_base"] == "http://roxira_embeddings:80/v1"
    assert params["api_key"] == "none"
    assert "os.environ" not in str(params)
    assert emb[0]["model_info"]["mode"] == "embedding"
    assert "fake-" not in str(cfg)


def test_agent_free_and_private_exclude_local_tei():
    for group in ("agent-free", "private"):
        deps = kc.group_deployments(pool(), group, set(FAKE_ENV))
        assert deps
        assert all(d.provider != "local-tei" for d in deps)


def test_private_group_has_no_free_or_may_log():
    deps = kc.group_deployments(pool(), "private", set(FAKE_ENV))
    assert deps
    for d in deps:
        assert d.data_policy == "no_train" and d.tier == "paid"
        assert not d.model.endswith(":free") and d.model != "openrouter/free"


def test_private_render_uses_prod_key_only():
    cfg = render_litellm.render(pool(), set(FAKE_ENV))
    priv = [m for m in cfg["model_list"] if m["model_name"] == "private"]
    assert priv
    assert all(m["litellm_params"]["api_key"] == "os.environ/OPENROUTER_API_KEY" for m in priv)


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
    post, calls = _post_factory({"api.groq.com": 429, "api.sambanova.ai": 503, "api.mistral.ai": 429})
    text, used = llm_pool.chat([{"role": "user", "content": "hi"}], "agent-strong-free", pool=pool(), env=FAKE_ENV,
                               post=post, rng=random.Random(1))
    assert text == "hello" and used.startswith("gemini/")
    hosts = [u.split("/")[2] for u, _ in calls]
    assert hosts[0] == "api.groq.com" and "generativelanguage.googleapis.com" in hosts


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
        "api.groq.com", "api.sambanova.ai", "api.mistral.ai",
        "generativelanguage.googleapis.com", "openrouter.ai"]})
    with pytest.raises(RuntimeError, match="all providers failed"):
        llm_pool.chat([{"role": "user", "content": "x"}], pool=pool(), env=FAKE_ENV, post=post)


def test_private_client_only_calls_paid_openrouter():
    post, calls = _post_factory({})
    llm_pool.chat([{"role": "user", "content": "x"}], "private", pool=pool(), env=FAKE_ENV, post=post)
    assert {u.split("/")[2] for u, _ in calls} == {"openrouter.ai"}
    assert not any(m.endswith(":free") for _, m in calls)


def test_render_adds_cost_callback_only_when_enabled():
    p = pool()
    assert p["gateway"]["cost_log"] is True
    cfg = render_litellm.render(p, set(FAKE_ENV))
    assert cfg["litellm_settings"]["callbacks"] == ["cost_logger.proxy_handler_instance"]
    for off in (False, None):
        p["gateway"]["cost_log"] = off
        assert "callbacks" not in render_litellm.render(p, set(FAKE_ENV))["litellm_settings"]


def test_product_free_falls_back_to_private_and_paid_has_prices():
    import render_litellm
    pool = kc.load_pool()
    cfg = render_litellm.render(pool)
    fb = {k: v for d in cfg["router_settings"].get("fallbacks", []) for k, v in d.items()}
    assert fb["product-free"] == ["private"]
    paid = [m for m in cfg["model_list"] if m["model_name"] == "private"]
    assert paid and all(m["litellm_params"].get("input_cost_per_token", 0) > 0 for m in paid)


def test_free_tier_deployments_cost_zero():
    import render_litellm
    cfg = render_litellm.render(kc.load_pool())
    free = [m for m in cfg["model_list"] if m["model_info"]["tier"] != "paid"]
    assert free and all(m["litellm_params"]["input_cost_per_token"] == 0.0 for m in free)


def test_ordered_group_is_a_rank_chain_over_all_keys():
    import render_litellm
    names = {"GEMINI_API_KEY", "GEMINI_API_KEY_2", "KEYPOOL_MASTER_KEY"}
    cfg = render_litellm.render(kc.load_pool(), names=names)
    ladder = [m for m in cfg["model_list"] if m["model_name"].startswith("gemini-best")]
    by_name = {}
    for m in ladder:
        by_name.setdefault(m["model_name"], set()).add((m["litellm_params"]["model"], m["litellm_params"]["api_key"]))
    assert all(len(v) == 2 and len({x[0] for x in v}) == 1 for v in by_name.values())  # one model, both keys
    assert not any("argon" in x[0] for v in by_name.values() for x in v)               # needs_billing skipped
    top = {x[0] for x in by_name["gemini-best"]}
    assert top == {"gemini/gemini-3.8-flash"}
    fb = {k: v for d in cfg["router_settings"]["fallbacks"] for k, v in d.items()}
    assert fb["gemini-best"][0] == "gemini-best__r2" and fb["gemini-best"][-1] == "agent-free-paid"
    assert all("order" not in m["litellm_params"] for m in cfg["model_list"])


def test_product_ladder_never_reaches_the_agents_key():
    import render_litellm
    cfg = render_litellm.render(kc.load_pool(), names={"GEMINI_API_KEY", "KEYPOOL_MASTER_KEY", "OPENROUTER_API_KEY"})
    fb = {k: v for d in cfg["router_settings"]["fallbacks"] for k, v in d.items()}
    chain = fb["gemini-best-product"]
    assert chain[-1] == "product-free" and "agent-free-paid" not in chain
    assert fb["product-free"] == ["private"]


def test_best_product_is_one_cross_provider_ladder():
    import render_litellm
    names = {"GEMINI_API_KEY", "GEMINI_API_KEY_2", "GROQ_API_KEY", "GROQ_API_KEY_2", "MISTRAL_API_KEY", "KEYPOOL_MASTER_KEY"}
    cfg = render_litellm.render(kc.load_pool(), names=names)
    fb = {k: v for d in cfg["router_settings"]["fallbacks"] for k, v in d.items()}
    chain = ["best-product"] + fb["best-product"]
    models = {}
    for m in cfg["model_list"]:
        if m["model_name"].startswith("best-product"):
            models.setdefault(m["model_name"], set()).add(m["litellm_params"]["model"])
    order = [sorted(models[n])[0] for n in chain if n in models]
    assert order[:3] == ["gemini/gemini-3.8-flash", "gemini/gemini-3.7-flash", "groq/openai/gpt-oss-120b"]
    assert chain[-1] == "private" and "agent-free-paid" not in chain
    groq_rank = [n for n in models if "groq/openai/gpt-oss-120b" in models[n]][0]
    assert len([m for m in cfg["model_list"] if m["model_name"] == groq_rank]) == 2   # both Groq keys in one rank


def test_free_ladder_has_no_paid_step_and_vip_is_paid_first():
    import render_litellm
    names = {"GEMINI_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "OPENROUTER_API_KEY", "KEYPOOL_MASTER_KEY"}
    cfg = render_litellm.render(kc.load_pool(), names=names)
    fb = {k: v for d in cfg["router_settings"]["fallbacks"] for k, v in d.items()}
    free_chain = ["best-product-free"] + fb.get("best-product-free", [])
    tiers = {m["model_info"]["tier"] for m in cfg["model_list"] if m["model_name"] in free_chain}
    assert tiers == {"free"}                                   # no paid deployment anywhere on the free path
    vip = [m for m in cfg["model_list"] if m["model_name"] == "vip-product"]
    assert vip and all(m["model_info"]["tier"] == "paid" for m in vip)
    assert fb["vip-product"] == ["vip-product__r2", "best-product-free"]   # never stops when credit runs out


def test_plan_groups_chain_down_to_free():
    import render_litellm
    cfg = render_litellm.render(kc.load_pool(), names={"OPENROUTER_API_KEY", "GEMINI_API_KEY", "KEYPOOL_MASTER_KEY"})
    fb = {k: v for d in cfg["router_settings"]["fallbacks"] for k, v in d.items()}
    assert fb["vip-premium"] == ["vip-premium__r2", "vip-pro"]
    assert fb["vip-pro"] == ["vip-pro__r2", "vip-pro__r3", "vip-product"]
    assert fb["vip-product"] == ["vip-product__r2", "best-product-free"]
    prem = {m["litellm_params"]["model"] for m in cfg["model_list"] if m["model_name"] == "vip-premium"}
    assert "openrouter/anthropic/claude-opus-5" in prem


def _chain(cfg, group):
    """[(model, params)] per rank of an ordered group, in fallback order (first deployment of each rank)."""
    fb = {k: v for d in cfg["router_settings"]["fallbacks"] for k, v in d.items()}
    out = []
    for n in [group] + [x for x in fb[group] if x.startswith(group + "__")]:
        m = next(m for m in cfg["model_list"] if m["model_name"] == n)
        out.append((m["litellm_params"]["model"].removeprefix("openrouter/"), m["litellm_params"]))
    return out


def _full_cfg():
    return render_litellm.render(kc.load_pool(), names={"OPENROUTER_API_KEY", "OPENROUTER_API_KEY_AGENTS", "GEMINI_API_KEY",
                                                         "GROQ_API_KEY", "MISTRAL_API_KEY", "KEYPOOL_MASTER_KEY"})


def test_plan_orders_and_free_end():
    cfg = _full_cfg()
    assert [m for m, _ in _chain(cfg, "vip-product")] == ["anthropic/claude-haiku-5.5", "deepseek/deepseek-v4.1-flash"]
    assert [m for m, _ in _chain(cfg, "vip-pro")] == ["anthropic/claude-haiku-5.5", "deepseek/deepseek-v4-pro", "z-ai/glm-5.3"]  # bake-off 2026-10-20
    assert [m for m, _ in _chain(cfg, "vip-premium")] == ["anthropic/claude-opus-5", "moonshotai/kimi-k3"]


def test_anthropic_cache_injection_only_on_anthropic_and_deepseek_sorts_by_price():
    cfg = _full_cfg()
    for m in cfg["model_list"]:
        p = m["litellm_params"]
        anthropic = "anthropic/" in p["model"]
        if m["model_name"].startswith("vip-"):
            assert ("cache_control_injection_points" in p) == anthropic, p["model"]
        if "deepseek-v4.1-flash" in p["model"] and m["model_name"] != "private":
            assert p["extra_body"]["provider"]["sort"] == "price"
            assert p["extra_body"]["provider"]["data_collection"] == "deny"  # provider-level body is kept
    for m in cfg["model_list"]:  # ordered groups keep the privacy flag of the private provider
        if m["model_name"].startswith("vip-"):
            assert m["litellm_params"]["extra_body"]["provider"]["data_collection"] == "deny"
            assert m["litellm_params"]["input_cost_per_token"] > 0


def test_free_ladder_follows_bakeoff_order():
    cfg = _full_cfg()
    chain = _chain(cfg, "best-product-free")
    ids = [m for m, _ in chain]
    for free in ("nvidia/nemotron-3-ultra-550b-a55b:free", "nvidia/nemotron-3-super-120b-a12b:free", "google/gemma-4-31b-it:free"):
        assert free in ids
    # 2026-10-20 bake-off: Nemotron Ultra, then Groq gpt-oss-120b, then Gemini 3.8 Flash and flash-lite lead the ladder
    assert ids.index("nvidia/nemotron-3-ultra-550b-a55b:free") < ids.index("gemini/gemini-3.8-flash")
    assert ids.index("gemini/gemini-3.5-flash-lite") < ids.index("gemini/gemini-3-flash-preview")


def test_summarize_cheap_then_free_ladder_and_cheap_agent_order():
    cfg = _full_cfg()
    fb = {k: v for d in cfg["router_settings"]["fallbacks"] for k, v in d.items()}
    assert [m for m, _ in _chain(cfg, "summarize-cheap")] == ["scaledown/summarize"]
    assert fb["summarize-cheap"] == ["best-product-free"]
    assert [m for m, _ in _chain(cfg, "agent-free-paid")] == ["z-ai/glm-5.3-flash", "deepseek/deepseek-v4.1-flash"]


# ---- every key of every provider (owner decision 2026-10-22) ----

SLOT_PROVIDERS = ["groq", "sambanova", "mistral", "gemini", "cerebras", "nvidia-nim", "cloudflare-ai",
                  "deepseek", "chutes", "together", "fireworks", "openrouter-private"]
NEW_PROVIDERS = {"cerebras", "nvidia-nim", "cloudflare-ai", "deepseek", "chutes", "together", "fireworks"}


def _fb(cfg):
    return {k: v for d in cfg["router_settings"]["fallbacks"] for k, v in d.items()}


def test_every_provider_has_four_key_slots():
    p = pool()
    for name in SLOT_PROVIDERS:
        keys = p["providers"][name]["keys"]
        base = keys[0]
        assert keys == [base, f"{base}_2", f"{base}_3", f"{base}_4"], name
    names = kc.all_key_names(p)
    assert "CF_ACCOUNT_ID" in names and "DEEPSEEK_API_KEY_4" in names and "OPENROUTER_API_KEY_AGENTS_4" in names


def test_unset_slots_skipped_and_all_set_slots_rendered():
    cfg = render_litellm.render(pool(), {"GROQ_API_KEY", "GROQ_API_KEY_3", "KEYPOOL_MASTER_KEY"})
    keys = {m["litellm_params"]["api_key"] for m in cfg["model_list"] if m["model_name"] == "agent-strong-free"}
    assert keys == {"os.environ/GROQ_API_KEY", "os.environ/GROQ_API_KEY_3"}
    all_groq = {f"GROQ_API_KEY{s}" for s in ("", "_2", "_3", "_4")}
    cfg = render_litellm.render(pool(), all_groq | {"KEYPOOL_MASTER_KEY"})
    keys = {m["litellm_params"]["api_key"] for m in cfg["model_list"] if m["model_name"] == "agent-strong-free"}
    assert keys == {f"os.environ/{k}" for k in all_groq}


def test_new_providers_are_inert_without_keys():
    cfg = render_litellm.render(pool(), set(FAKE_ENV))
    assert not any(m["model_info"]["id"].split(":")[1] in NEW_PROVIDERS for m in cfg["model_list"])
    # and every one of them renders once a key is set
    p = pool()
    names = {p["providers"][n]["keys"][0] for n in NEW_PROVIDERS} | {"CF_ACCOUNT_ID", "KEYPOOL_MASTER_KEY"}
    cfg = render_litellm.render(p, names)
    assert {m["model_info"]["id"].split(":")[1] for m in cfg["model_list"]} >= NEW_PROVIDERS


def test_rank_shares_load_across_all_keys_of_all_providers():
    names = {"GROQ_API_KEY", "GROQ_API_KEY_2", "CEREBRAS_API_KEY", "NVIDIA_API_KEY", "NVIDIA_API_KEY_2", "GEMINI_API_KEY",
             "KEYPOOL_MASTER_KEY"}
    cfg = render_litellm.render(pool(), names)
    fb = _fb(cfg)
    chain = ["best-product-free"] + fb["best-product-free"]
    rank = next(n for n in chain if any(m["model_name"] == n and m["litellm_params"]["model"].startswith("groq/")
                                        for m in cfg["model_list"]))
    deps = [m for m in cfg["model_list"] if m["model_name"] == rank]
    # unverified providers (Cerebras, NIM) share no customer-facing rank until they graduate (docs/infra/KEY_POOL.md)
    assert {m["litellm_params"]["api_key"] for m in deps} == {"os.environ/GROQ_API_KEY", "os.environ/GROQ_API_KEY_2"}
    assert {m["litellm_params"]["model"].split("/")[0] for m in deps} == {"groq"}
    # while the agent ladder (public data only) does share the rank across them
    agent = [m for m in cfg["model_list"] if m["model_name"].startswith("best-all")]
    assert {m["litellm_params"]["model"].split("/")[0] for m in agent} >= {"groq", "cerebras", "nvidia_nim"}
    # simple-shuffle only looks at the first deployment's keys: every deployment must carry a weight
    assert all(isinstance(m["litellm_params"]["weight"], int) and m["litellm_params"]["weight"] > 0
               for m in cfg["model_list"])
    assert fb["best-product-free"][-1] != "private"  # still no paid step for free users
    tiers = {m["model_info"]["tier"] for m in cfg["model_list"] if m["model_name"] in chain}
    assert tiers == {"free"}


def test_limits_per_key_override():
    p = pool()
    p["providers"]["groq"]["limits_per_key"] = {"GROQ_API_KEY_2": {"rpm": 90, "weight": 5}, "GROQ_API_KEY_4": {"tpm": 1}}
    cfg = render_litellm.render(p, {"GROQ_API_KEY", "GROQ_API_KEY_2", "GROQ_API_KEY_4", "KEYPOOL_MASTER_KEY"})
    got = {m["litellm_params"]["api_key"]: m["litellm_params"] for m in cfg["model_list"]
           if m["model_name"] == "agent-strong-free"}
    assert (got["os.environ/GROQ_API_KEY"]["rpm"], got["os.environ/GROQ_API_KEY"]["weight"]) == (30, 30)
    assert (got["os.environ/GROQ_API_KEY_2"]["rpm"], got["os.environ/GROQ_API_KEY_2"]["weight"]) == (90, 5)
    assert (got["os.environ/GROQ_API_KEY_4"]["tpm"], got["os.environ/GROQ_API_KEY_4"]["rpm"]) == (1, 30)


def test_cloudflare_needs_account_id_and_never_puts_a_key_in_the_url():
    p = pool()
    cfg = render_litellm.render(p, {"CF_AI_TOKEN", "KEYPOOL_MASTER_KEY"})
    assert not any("cloudflare" in str(m["litellm_params"].get("api_base")) for m in cfg["model_list"])
    cfg = render_litellm.render(p, {"CF_AI_TOKEN", "CF_AI_TOKEN_2", "CF_ACCOUNT_ID", "KEYPOOL_MASTER_KEY"},
                                values={"CF_ACCOUNT_ID": "acc123", "CF_AI_TOKEN": "secret-token"})
    cf = [m["litellm_params"] for m in cfg["model_list"] if "cloudflare" in str(m["litellm_params"].get("api_base"))]
    assert cf and all(x["api_base"] == "https://api.cloudflare.com/client/v4/accounts/acc123/ai/v1" for x in cf)
    assert {x["api_key"] for x in cf} == {"os.environ/CF_AI_TOKEN", "os.environ/CF_AI_TOKEN_2"}
    assert "secret-token" not in str(cfg)


def test_openrouter_paid_uses_all_agents_keys_else_prod():
    p = pool()
    deps = kc.group_deployments(p, "agent-free-paid", {"OPENROUTER_API_KEY", "OPENROUTER_API_KEY_AGENTS_2",
                                                       "OPENROUTER_API_KEY_AGENTS_3"})
    assert {d.key_env for d in deps} == {"OPENROUTER_API_KEY_AGENTS_2", "OPENROUTER_API_KEY_AGENTS_3"}
    deps = kc.group_deployments(p, "agent-free-paid", {"OPENROUTER_API_KEY"})
    assert {d.key_env for d in deps} == {"OPENROUTER_API_KEY"}


def test_private_group_stays_product_keys_only_and_refuses_new_free_or_may_log():
    p = pool()
    every = set(kc.all_key_names(p))
    deps = kc.group_deployments(p, "private", every)
    assert {d.key_env for d in deps} == {"OPENROUTER_API_KEY", "OPENROUTER_API_KEY_2", "OPENROUTER_API_KEY_3",
                                         "OPENROUTER_API_KEY_4"}
    assert all(d.provider == "openrouter-private" and d.extra_body["provider"]["data_collection"] == "deny" for d in deps)
    for bad in ("deepseek", "cerebras", "nvidia-nim", "cloudflare-ai", "chutes", "together", "fireworks"):
        q = pool()
        q["groups"]["private"]["providers"] = ["openrouter-private", bad]
        with pytest.raises(kc.PoolError):
            kc.group_deployments(q, "private", every)


def test_paid_ladders_include_direct_and_extra_paid_keys():
    p = pool()
    names = {"OPENROUTER_API_KEY", "OPENROUTER_API_KEY_AGENTS", "DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY_2",
             "TOGETHER_API_KEY", "FIREWORKS_API_KEY", "CHUTES_API_KEY", "KEYPOOL_MASTER_KEY"}
    cfg = render_litellm.render(p, names)
    fb = _fb(cfg)
    assert fb["agent-free-paid"] == ["agent-free-paid__r2", "agent-free-paid__r3"]
    r2 = [m["litellm_params"] for m in cfg["model_list"] if m["model_name"] == "agent-free-paid__r2"]
    assert {x["model"] for x in r2} == {"openrouter/deepseek/deepseek-v4.1-flash", "deepseek/deepseek-chat"}
    assert len(r2) == 3  # 1 agents key + 2 DeepSeek keys
    r3 = [m["litellm_params"] for m in cfg["model_list"] if m["model_name"] == "agent-free-paid__r3"]
    assert {x["model"].split("/")[0] for x in r3} == {"openai", "together_ai", "fireworks_ai"}
    assert all(x["input_cost_per_token"] > 0 for x in r2 + r3)
    vip2 = [m["litellm_params"]["model"] for m in cfg["model_list"] if m["model_name"] == "vip-product__r2"]
    assert "deepseek/deepseek-chat" not in vip2   # paid subscribers stay on the product key (no_train)
    assert fb["vip-product"] == ["vip-product__r2", "best-product-free"]


def test_inventory_dry_run_lists_names_only_and_probe_uses_one_token():
    import inventory
    env = {"GROQ_API_KEY": "fake-secret-1", "GROQ_API_KEY_3": "fake-secret-3", "CF_AI_TOKEN": "fake-cf"}
    lines: list[str] = []
    assert inventory.inventory(pool(), env, out=lines.append) == 1  # CF token set without CF_ACCOUNT_ID
    text = "\n".join(lines)
    assert "fake-" not in text
    assert "GROQ_API_KEY_2                   unset" in text and "would probe" in text
    assert "needs CF_ACCOUNT_ID" in text
    calls = []

    def post(url, headers, body, timeout):
        calls.append((url, body["max_tokens"]))
        return (429 if headers["Authorization"].endswith("3") else 200), {}

    lines.clear()
    rc = inventory.inventory(pool(), {k: v for k, v in env.items() if k.startswith("GROQ")}, probe=True,
                             post=post, out=lines.append)
    assert rc == 1 and len(calls) == 2 and all(mt == 1 for _, mt in calls)
    assert any("GROQ_API_KEY_3" in ln and "429" in ln for ln in lines)
    assert "fake-" not in "\n".join(lines)


def test_client_weighted_shuffle_prefers_heavier_keys():
    heavy = kc.Deployment("g", "a", "free", "may_log", "u", "x", "HEAVY", "m", 1, weight=99)
    light = kc.Deployment("g", "b", "free", "may_log", "u", "x", "LIGHT", "m", 1, weight=1)
    rng = random.Random(7)
    first = [llm_pool.ordered([light, heavy], rng)[0].key_env for _ in range(300)]
    assert first.count("HEAVY") > 250


CUSTOMER_FACING = ["product-free", "gemini-best-product", "best-product", "best-product-free", "vip-product", "vip-pro",
                   "vip-premium", "vip-team", "summarize-cheap", "private"]


def test_unverified_providers_stay_out_of_customer_facing_groups():
    p = pool()
    every = set(kc.all_key_names(p)) | {"KEYPOOL_MASTER_KEY"}
    cfg = render_litellm.render(p, every, values={"CF_ACCOUNT_ID": "acc123"})
    fb = _fb(cfg)
    reach = set()
    todo = list(CUSTOMER_FACING)
    while todo:
        g = todo.pop()
        if g in reach:
            continue
        reach.add(g)
        todo.extend(fb.get(g, []))
    assert "candidates" not in reach
    bad = {"cerebras", "nvidia_nim", "deepseek", "together_ai", "fireworks_ai"}
    for m in cfg["model_list"]:
        name = m["model_name"].split("__")[0]
        if name in reach:
            assert m["litellm_params"]["model"].split("/")[0] not in bad, (name, m["litellm_params"]["model"])
            assert "llm.chutes.ai" not in str(m["litellm_params"].get("api_base"))
            assert "cloudflare" not in str(m["litellm_params"].get("api_base"))
    assert any(m["model_name"].startswith("candidates") for m in cfg["model_list"])
