"""Phone-gateway service identity (edge phone agent) in chat_auth."""
from output_apps.generated_modules.smartjudge import chat_auth

KEY = "k" * 40


def test_off_when_key_unset_or_short(monkeypatch):
    monkeypatch.delenv("SMARTJUDGE_PHONE_GATEWAY_KEY", raising=False)
    user = chat_auth.authenticate({"x-phone-gateway-key": KEY})
    assert user.token_invalid and not user.authenticated
    monkeypatch.setenv("SMARTJUDGE_PHONE_GATEWAY_KEY", "short")
    assert chat_auth.authenticate({"x-phone-gateway-key": "short"}).token_invalid


def test_absent_header_is_plain_anonymous(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_PHONE_GATEWAY_KEY", KEY)
    user = chat_auth.authenticate({})
    assert user == chat_auth.ANONYMOUS


def test_matching_key_gives_gateway_identity(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_PHONE_GATEWAY_KEY", KEY)
    user = chat_auth.authenticate({"x-phone-gateway-key": KEY, "authorization": "Bearer whatever"})
    assert user.authenticated and not user.token_invalid
    assert user.phone == chat_auth.PHONE_GATEWAY_ID
    assert chat_auth.user_level(user) == "vip"
    assert chat_auth.is_phone_gateway(user)


def test_wrong_key_is_rejected_not_anonymous(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_PHONE_GATEWAY_KEY", KEY)
    user = chat_auth.authenticate({"x-phone-gateway-key": "x" * 40})
    assert user.token_invalid and not user.authenticated
    assert chat_auth.deny_if_invalid(user) is not None


def test_gateway_has_its_own_daily_counter(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_PHONE_GATEWAY_KEY", KEY)
    monkeypatch.setenv("PHONE_GATEWAY_DAILY_LIMIT", "123")
    gw = chat_auth.authenticate({"x-phone-gateway-key": KEY})
    key, limit, kind = chat_auth.daily_chat_key(gw, "1.2.3.4")
    assert key == "rl:chat-day:phone:phone-gateway" and limit == 123 and kind == "vip"
    web_vip = chat_auth.CurrentUser(phone="09120000000", tier="VIP", authenticated=True)
    assert chat_auth.daily_chat_key(web_vip, "1.2.3.4")[0] != key
    assert not chat_auth.is_phone_gateway(web_vip)
