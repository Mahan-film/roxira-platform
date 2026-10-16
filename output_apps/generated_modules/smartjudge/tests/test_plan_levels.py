"""Plan levels: derivation, model routing, top-model caps, daily limits, /plans exposure. Offline."""

import pytest

from output_apps.generated_modules.smartjudge import chat_auth, llm_gateway, plan_limits
from output_apps.generated_modules.smartjudge import smartjudge_module as mod

ENVS = (
    "SMARTJUDGE_LLM_GATEWAY_MODEL", "SMARTJUDGE_LLM_GATEWAY_MODEL_FREE", "SMARTJUDGE_LLM_GATEWAY_MODEL_VIP",
    "SMARTJUDGE_LLM_GATEWAY_MODEL_BASIC", "SMARTJUDGE_LLM_GATEWAY_MODEL_PRO", "SMARTJUDGE_LLM_GATEWAY_MODEL_PREMIUM",
    "CHAT_ANON_DAILY_LIMIT", "CHAT_FREE_DAILY_LIMIT", "CHAT_VIP_DAILY_LIMIT", "CHAT_BASIC_DAILY_LIMIT",
    "CHAT_PRO_DAILY_LIMIT", "CHAT_PREMIUM_DAILY_LIMIT", "SJ_PRO_TOP_DAILY", "SJ_PREMIUM_TOP_DAILY",
)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for name in ENVS:
        monkeypatch.delenv(name, raising=False)
    chat_auth.reset_for_tests()


def _user(level, tier=None, phone="09120000001"):
    tier = tier or ("FREE" if level == "free" else "VIP")
    return chat_auth.CurrentUser(phone=phone, tier=tier, authenticated=True, plan_level=level)


# --- plan_level derivation from entitlement plan types ------------------------------
@pytest.mark.parametrize("plans,expected", [
    ([], "free"),
    (["SINGLE_DRAFT"], "free"),
    (["SJ_BASIC_MONTHLY"], "basic"),
    (["SJ_PRO_YEARLY"], "pro"),
    (["SJ_PREMIUM_MONTHLY"], "premium"),
    (["VIP_MONTHLY_PRO"], "pro"),
    (["VIP"], "pro"),
    (["SJ_BASIC_MONTHLY", "VIP_MONTHLY_PRO"], "pro"),
    (["SJ_BASIC_YEARLY", "SJ_PREMIUM_YEARLY"], "premium"),
])
def test_plan_level_from_plan_types(plans, expected):
    assert mod._plan_level_from_plan_types(plans) == expected


def test_entitlement_info_sets_tier_and_level(monkeypatch):
    class Cur:
        def __init__(self, rows):
            self.rows = rows

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def execute(self, *a, **k):
            pass

        def fetchall(self):
            return self.rows

    class Conn(Cur):
        def cursor(self):
            return Cur(self.rows)

    monkeypatch.setattr(mod.payment_orders, "_dsn", lambda: "postgresql://unused")
    for rows, expected in ((["SJ_PREMIUM_YEARLY"], ("VIP", "premium")), (["VIP_MONTHLY_PRO"], ("VIP", "pro")),
                           (["SINGLE_DRAFT"], ("FREE", "free")), ([], ("FREE", "free"))):
        mod._ENTITLEMENT_CACHE.clear()
        monkeypatch.setattr(mod.psycopg, "connect", lambda *a, _r=rows, **k: Conn([(r,) for r in _r]))
        assert mod._entitlement_info("09120000001") == expected
    mod._ENTITLEMENT_CACHE.clear()


def test_user_from_token_carries_level(monkeypatch):
    monkeypatch.setattr(mod, "_decode_jwt", lambda t: {"phone": "09120000001"})
    monkeypatch.setattr(mod, "_entitlement_info", lambda phone: ("VIP", "pro"))
    user = mod._user_from_token("x")
    assert (user.tier, user.plan_level, user.authenticated) == ("VIP", "pro", True)


# --- model_for per level -------------------------------------------------------------
def test_model_for_levels_defaults():
    assert llm_gateway.model_for("free") == llm_gateway.model_for("FREE") == "best-product-free"
    assert llm_gateway.model_for("basic") == "vip-product"
    assert llm_gateway.model_for("pro") == "vip-pro"
    assert llm_gateway.model_for("premium") == "vip-premium"
    assert llm_gateway.model_for("VIP") == "vip-product"  # legacy unchanged


def test_model_for_levels_env(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_LLM_GATEWAY_MODEL_BASIC", "b")
    monkeypatch.setenv("SMARTJUDGE_LLM_GATEWAY_MODEL_PRO", "p")
    monkeypatch.setenv("SMARTJUDGE_LLM_GATEWAY_MODEL_PREMIUM", "x")
    monkeypatch.setenv("SMARTJUDGE_LLM_GATEWAY_MODEL_FREE", "f")
    assert [llm_gateway.model_for(t) for t in ("basic", "pro", "premium", "free")] == ["b", "p", "x", "f"]


def test_paid_levels_may_use_paid():
    for lv in ("basic", "pro", "premium", "VIP"):
        assert llm_gateway.may_use_paid(lv)
    assert not llm_gateway.may_use_paid("free")


# --- top-model caps ------------------------------------------------------------------
def test_premium_top_cap_switches_to_pro(monkeypatch):
    monkeypatch.setenv("SJ_PREMIUM_TOP_DAILY", "3")
    u = _user("premium")
    plans = [chat_auth.gateway_plan_for(u)[0] for _ in range(5)]
    assert plans == ["premium"] * 3 + ["pro"] * 2
    assert [llm_gateway.model_for(p) for p in plans] == ["vip-premium"] * 3 + ["vip-pro"] * 2


def test_pro_top_cap_switches_to_product(monkeypatch):
    monkeypatch.setenv("SJ_PRO_TOP_DAILY", "2")
    u = _user("pro")
    plans = [chat_auth.gateway_plan_for(u)[0] for _ in range(4)]
    assert [llm_gateway.model_for(p) for p in plans] == ["vip-pro"] * 2 + ["vip-product"] * 2


def test_top_cap_default_values_and_refund():
    assert chat_auth.premium_top_daily() == 20 and chat_auth.pro_top_daily() == 60
    u = _user("premium")
    plan, key = chat_auth.gateway_plan_for(u)
    assert plan == "premium" and key
    chat_auth.decr(key)  # refund when no answer was produced
    assert chat_auth.incr(key, 60)[0] == 1


def test_top_cap_is_per_user():
    a, b = _user("pro", phone="09120000001"), _user("pro", phone="09120000002")
    chat_auth.gateway_plan_for(a)
    assert chat_auth.gateway_plan_for(b)[1].endswith("09120000002")


def test_other_levels_have_no_top_counter():
    assert chat_auth.gateway_plan_for(_user("basic")) == ("basic", None)
    assert chat_auth.gateway_plan_for(_user("free")) == ("FREE", None)
    assert chat_auth.gateway_plan_for(_user("free", tier="VIP")) == ("VIP", None)  # legacy VIP
    assert chat_auth.gateway_plan_for(chat_auth.CurrentUser()) == ("FREE", None)


# --- daily limits per level ------------------------------------------------------------
@pytest.mark.parametrize("user,kind,limit", [
    (chat_auth.CurrentUser(), "guest", 5),
    (_user("free"), "free", 20),
    (_user("basic"), "basic", 40),
    (_user("pro"), "pro", 150),
    (_user("premium"), "premium", 300),
    (_user("free", tier="VIP"), "vip", 300),  # legacy VIP without a level
])
def test_daily_limit_per_level(user, kind, limit):
    key, lim, k = chat_auth.daily_chat_key(user, "1.2.3.4")
    assert (lim, k) == (limit, kind)


def test_daily_limit_env(monkeypatch):
    monkeypatch.setenv("CHAT_BASIC_DAILY_LIMIT", "2")
    key, lim, _ = chat_auth.daily_chat_key(_user("basic"), "ip")
    assert [chat_auth.count_daily_chat(key, lim)[0] for _ in range(3)] == [True, True, False]


def test_upsell_points_to_next_tier():
    import json

    basic = json.loads(chat_auth.daily_limit_response("basic", 10).body)
    pro = json.loads(chat_auth.daily_limit_response("pro", 10).body)
    assert basic["code"] == pro["code"] == "UPGRADE_REQUIRED" and basic["plans_url"] == "/plans"
    assert basic["next_plan"] == "SJ_PRO_MONTHLY" and pro["next_plan"] == "SJ_PREMIUM_MONTHLY"
    assert json.loads(chat_auth.daily_limit_response("premium", 10).body)["code"] == "DAILY_LIMIT"
    assert json.loads(chat_auth.daily_limit_response("vip", 10).body)["code"] == "DAILY_LIMIT"


# --- drafts + /plans exposure ------------------------------------------------------------
def test_vip_drafts_by_level():
    assert not chat_auth.vip_drafts_allowed(_user("basic"))
    assert not chat_auth.vip_drafts_allowed(_user("free"))
    assert not chat_auth.vip_drafts_allowed(chat_auth.CurrentUser())
    for lv in ("pro", "premium"):
        assert chat_auth.vip_drafts_allowed(_user(lv))
    assert chat_auth.vip_drafts_allowed(_user("free", tier="VIP"))


def test_vip_drafts_route_gate_blocks_basic_only():
    class Req:
        headers = {}

    assert mod._vip_drafts_allowed(None, "VIP", _user("pro"))
    assert not mod._vip_drafts_allowed(None, "VIP", _user("basic"))
    assert not mod._vip_drafts_allowed(Req(), "FREE")


def test_plan_limits_expose_levels(monkeypatch):
    monkeypatch.setenv("SJ_PREMIUM_TOP_DAILY", "7")
    lim = plan_limits.get_plan_limits()
    assert lim["chat_messages_per_day"] == {
        "guest": 5, "free": 20, "vip": 300, "basic": 40, "pro": 150, "premium": 300}
    assert lim["top_model_answers_per_day"] == {"pro": 60, "premium": 7}
    assert "ruling" not in lim["draft_types"]["basic"] and "ruling" in lim["draft_types"]["pro"]
    assert "ruling" in lim["draft_types"]["premium"]
