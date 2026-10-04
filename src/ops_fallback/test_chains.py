import pytest

from src.ops_fallback.chains import (
    AllStepsFailed,
    Cooldown,
    StepFailure,
    run_with_fallback,
)
from src.ops_fallback.loader import active_steps, load_config
from src.ops_fallback.search_adapter import search_with_fallback


class Clock:
    t = 0.0

    def __call__(self):
        return self.t


def test_first_success():
    out = run_with_fallback(["a", "b"], lambda s: s.upper())
    assert out["result"] == "A"
    assert out["attempts"] == [{"step": "a", "status": "ok"}]


def test_falls_through_on_retryable_codes():
    def call(s):
        if s == "a":
            raise StepFailure(429)
        if s == "b":
            raise TimeoutError("secret-url")
        return "c-ok"

    out = run_with_fallback(["a", "b", "c"], call)
    assert out["step"] == "c"
    assert out["attempts"] == [
        {"step": "a", "status": 429},
        {"step": "b", "status": "error"},
        {"step": "c", "status": "ok"},
    ]
    assert "secret" not in repr(out["attempts"])


def test_non_retryable_stops():
    def call(s):
        raise StepFailure(400)

    with pytest.raises(AllStepsFailed) as ei:
        run_with_fallback(["a", "b"], call)
    assert ei.value.attempts == [{"step": "a", "status": 400}]


def test_all_fail():
    def call(s):
        raise StepFailure(503)

    with pytest.raises(AllStepsFailed) as ei:
        run_with_fallback(["a", "b"], call)
    assert len(ei.value.attempts) == 2


def test_cooldown_opens_and_recovers():
    clock = Clock()
    cd = Cooldown(threshold=2, seconds=10, clock=clock)
    calls = []

    def call(s):
        calls.append(s)
        if s == "a":
            raise StepFailure(500)
        return "ok"

    for _ in range(2):
        run_with_fallback(["a", "b"], call, cooldown=cd)
    calls.clear()
    out = run_with_fallback(["a", "b"], call, cooldown=cd)
    assert calls == ["b"]
    assert out["attempts"][0] == {"step": "a", "status": "cooldown"}
    clock.t = 11
    run_with_fallback(["a", "b"], call, cooldown=cd)
    assert calls == ["b", "a", "b"]


def test_config_and_loader_skip_unset():
    cfg = load_config()
    assert cfg["chains"]["llm_cheap"]["steps"] == [
        "openrouter",
        "mistral",
        "sambanova",
        "omniroute",
    ]
    assert cfg["chains"]["stt"]["steps"] == ["assemblyai"]
    assert all(c["allow_free_tier"] is False for c in cfg["chains"].values())
    env = {"MISTRAL_API_KEY": "x", "OMNIROUTE_API_KEY": " "}
    assert active_steps(cfg, "llm_cheap", env) == ["mistral"]
    assert active_steps(cfg, "search_web", {"BRAVE_API_KEY": "k"}) == ["brave"]


class Fake:
    def __init__(self, resp):
        self.resp = resp

    def search(self, q):
        return self.resp


def test_search_adapter_fallback():
    env = {"TAVILY_KEYS": "a", "BRAVE_API_KEY": "b", "EXA_API_KEY": "c"}
    clients = {
        "tavily": Fake({"status": "ERROR", "error": "x"}),
        "brave": Fake({"status": "SUCCESS", "results": []}),
        "exa": Fake({"status": "SUCCESS", "results": [{"url": "u"}]}),
    }
    out = search_with_fallback("q", clients=clients, env=env, cooldown=Cooldown())
    assert out["provider"] == "exa"
    assert [a["step"] for a in out["attempts"]] == ["tavily", "brave", "exa"]


def test_search_adapter_all_fail():
    clients = {"tavily": Fake({"status": "ERROR", "http_code": 429})}
    with pytest.raises(AllStepsFailed):
        search_with_fallback(
            "q", clients=clients, env={"TAVILY_KEYS": "a"}, cooldown=Cooldown()
        )
