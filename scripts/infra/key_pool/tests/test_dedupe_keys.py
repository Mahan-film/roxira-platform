import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "dev"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import keypool_config as kc  # noqa: E402
import llm_pool as lp  # noqa: E402


def _dep(provider, key_env, model="m"):
    return kc.Deployment(**{**{f: None for f in kc.Deployment.__dataclass_fields__}, "provider": provider, "key_env": key_env, "model": model})


def test_duplicate_key_values_collapse_per_provider_and_model():
    deps = [_dep("groq", "K1"), _dep("groq", "K2"), _dep("groq", "K3"), _dep("groq", "K1", "other")]
    out = lp.dedupe_keys(deps, {"K1": "same", "K2": "same", "K3": "different"})
    assert [(d.key_env, d.model) for d in out] == [("K1", "m"), ("K3", "m"), ("K1", "other")]


def test_429_on_first_key_rotates_to_the_next_distinct_key():
    deps_env = {"K1": "a", "K2": "a", "K3": "b"}
    calls = []

    def post(url, headers, body, timeout):
        calls.append(headers["Authorization"])
        return (429, None) if len(calls) == 1 else (200, {"choices": [{"message": {"content": "ok"}}]})

    pool = {"providers": {"p": {"base_url": "http://x", "tier": "free", "data_policy": "may_log", "litellm_prefix": "p", "keys": ["K1", "K2", "K3"], "models": [{"id": "m"}]}},
            "groups": {"g": {"providers": ["p"]}}, "gateway": {"master_key_env": "M"}}
    text, used = lp.chat([{"role": "user", "content": "x"}], "g", 4, pool=pool, env=deps_env, post=post)
    assert text == "ok" and len(calls) == 2 and calls[0] != calls[1]
