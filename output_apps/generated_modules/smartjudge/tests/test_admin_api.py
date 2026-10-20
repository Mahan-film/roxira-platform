"""Owner admin console API: authz (401/403/429), strict validation, entitlement grant + audit, payments,
research jobs, site-check refusals, task queue (real taskq.py in a temp dir), marketing state machine (real
mkt_store in a temp dir), cost-log reading. Offline: a fake store replaces Postgres."""
import asyncio
import datetime as dt
import json
import sqlite3
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from output_apps.ecosystem_core.src.billing import crypto_payment_service as cps
from output_apps.generated_modules.smartjudge import admin_api, admin_hostdata as hd, admin_site_check as sc
from output_apps.generated_modules.smartjudge import chat_auth
from output_apps.generated_modules.smartjudge.admin_store import StoreError

BASE = "/admin/console"
ADMIN = "09120000009"
USER = "09120000001"
OUR_ADDRESS = cps.USDT_TRC20_CONTRACT  # any valid base58check TRON address works as the receiving address
REPO = Path(__file__).resolve().parents[4]


def _norm(p: str) -> str:
    return p.strip()


class FakeStore:
    tenant = "smartjudge"

    def __init__(self):
        self.audit: list[dict] = []
        self.entitlements: dict[str, dict] = {}
        self.orders: dict[str, dict] = {}
        self.unmatched: dict[str, dict] = {}
        self.settled: list[tuple] = []

    # users / entitlements
    def email_user_ref(self, email):
        return "em_0123456789abcdef" if email == "known@example.com" else None

    def get_entitlement(self, user_ref):
        return self.entitlements.get(user_ref)

    def orders_for_user(self, user_ref, limit=5):
        return []

    def apply_entitlement(self, *, user_ref, action, plan_type, days, reason, actor):
        before = self.entitlements.get(user_ref)
        if action == "extend" and before is None:
            raise StoreError(404, "no entitlement", "NO_ENTITLEMENT")
        if action == "revoke" and (before is None or not before["active"]):
            raise StoreError(409, "nothing to revoke", "NOTHING_TO_REVOKE")
        if action == "grant":
            self.entitlements[user_ref] = {"plan_type": plan_type, "status": "ADMIN_GRANT", "active": True, "days": days}
        elif action == "revoke":
            self.entitlements[user_ref] = {**before, "active": False, "status": "ADMIN_REVOKED"}
        self.audit.append({"actor": actor, "action": f"entitlement_{action}", "target": user_ref, "reason": reason,
                           "detail": {"before": before, "days": days}})
        return {"before": before, "after": self.entitlements.get(user_ref)}

    def write_audit(self, *, actor, action, target, reason, detail=None):
        self.audit.append({"actor": actor, "action": action, "target": target, "reason": reason, "detail": detail or {}})

    def list_audit(self, limit=50, target=None):
        return [a for a in self.audit if target in (None, a["target"])][-limit:]

    def dashboard(self, windows):
        return {"windows": {n: {"new_email_users": 1, "new_phone_users": 2, "active_users": 3,
                                "questions_by_plan_type": {"FREE": 5, "SJ_PRO_MONTHLY": 7},
                                "paid": {"zibal": {"orders": 2, "amount_rial": 20_000_000, "amount_usdt": "0"},
                                         "usdt_trc20": {"orders": 1, "amount_rial": 0, "amount_usdt": "10.003417"}},
                                "orders_by_status": {"paid": 3, "pending": 1}} for n in windows},
                "subscriptions": {"SJ_PRO_MONTHLY": 4, "SJ_BASIC_YEARLY": 1}, "errors": [], "pending_activation": 0}

    # payments
    def list_orders(self, *, method, status, limit, offset):
        return {"orders": [{"track_id": "123456", "plan_type": "SJ_PRO_MONTHLY", "amount_rial": 4_900_000,
                            "status": "paid", "phone": ADMIN, "user_ref": "a" * 16, "method": "zibal",
                            "activation_suspect": False}], "errors": []}

    def list_unmatched(self, limit=100):
        return {"unmatched": [{"tx_hash": "a" * 64, "sender": "TX", "value_micro": 10_003_417}], "errors": []}

    def get_order(self, track_id):
        return self.orders.get(track_id)

    def get_unmatched(self, tx_hash):
        return self.unmatched.get(tx_hash)

    def settle_crypto_match(self, *, track_id, tx_hash, actor, reason, detail):
        self.settled.append((track_id, tx_hash, actor, reason))
        self.orders[track_id]["status"] = "paid"
        self.unmatched[tx_hash]["resolved"] = True
        self.audit.append({"actor": actor, "action": "crypto_match", "target": track_id, "reason": reason, "detail": detail})
        return {"track_id": track_id, "tx_hash": tx_hash}


@pytest.fixture(autouse=True)
def _env(monkeypatch, tmp_path):
    chat_auth.reset_for_tests()
    monkeypatch.setenv("CRYPTO_USDT_TRC20_ADDRESS", OUR_ADDRESS)
    monkeypatch.setenv("ADMIN_AGENTS_HOME", str(tmp_path / "agents"))
    monkeypatch.setenv("ADMIN_MKT_HOME", str(tmp_path / "mkt"))
    monkeypatch.setenv("ADMIN_COST_LOG", str(tmp_path / "requests.jsonl"))
    monkeypatch.setenv("ADMIN_BAKEOFF_DIR", str(tmp_path / "bakeoff"))
    monkeypatch.setenv("ADMIN_DEPLOY_STATE_DIR", str(tmp_path / "deploy"))
    monkeypatch.setenv("ADMIN_HOST_STATUS", str(tmp_path / "host_status.json"))
    monkeypatch.setenv("ADMIN_USD_TOMAN_RATE", "300000")
    admin_api._cost_cache.update(until=0.0, value=None)
    yield
    chat_auth.reset_for_tests()


def make_app(store=None, **kw):
    store = store or FakeStore()
    changes = []

    async def current(request):
        who = request.headers.get("x-test-user", "")
        if who == "bad":
            return chat_auth._INVALID
        if who in (ADMIN, USER):
            return chat_auth.CurrentUser(phone=who, tier="FREE", authenticated=True)
        return chat_auth.ANONYMOUS

    from fastapi import Request

    async def dep(request: Request):
        return await current(request)

    admins = kw.pop("admins", {ADMIN})
    router = admin_api.build_router(
        get_current_user=dep, admin_phones=lambda: admins, store=store, normalize_phone=_norm,
        is_valid_phone=lambda p: p.startswith("09") and len(p) == 11,
        on_entitlement_change=lambda: changes.append(1), **kw)
    app = FastAPI()
    app.include_router(router)
    return TestClient(app), store, changes


def H(who=ADMIN):
    return {"x-test-user": who}


GET_ROUTES = ["/me", "/dashboard", "/users/lookup?q=09120000001", "/audit", "/payments", "/payments/unmatched",
              "/models", "/research/abcdefgh", "/agents/tasks", "/marketing", "/health"]
POST_ROUTES = [("/users/entitlement", {"user_ref": "a" * 16, "action": "revoke", "reason": "abc"}),
               ("/payments/match-crypto", {"track_id": "USDT_" + "a" * 32, "tx_hash": "a" * 64, "reason": "abc"}),
               ("/payments/reverify", {"track_id": "123456", "reason": "abc"}),
               ("/research", {"query": "مهلت تجدیدنظر چند روز است"}),
               ("/site-check", {"url": "https://example.com/"}),
               ("/agents/tasks", {"slug": "abc-task", "task": "do something useful"}),
               ("/marketing/decision", {"post_id": 1, "decision": "approve"})]


# ------------------------------------------------------------------ authz
@pytest.mark.parametrize("path", GET_ROUTES)
def test_get_routes_401_without_token(path):
    client, *_ = make_app()
    assert client.get(BASE + path).status_code == 401


@pytest.mark.parametrize("path,body", POST_ROUTES)
def test_post_routes_401_without_token(path, body):
    client, *_ = make_app()
    assert client.post(BASE + path, json=body).status_code == 401


def test_invalid_token_401():
    client, *_ = make_app()
    r = client.get(BASE + "/me", headers=H("bad"))
    assert r.status_code == 401 and r.json()["detail"]["code"] == "TOKEN_INVALID"


@pytest.mark.parametrize("path", GET_ROUTES)
def test_get_routes_403_for_non_admin(path):
    client, *_ = make_app()
    r = client.get(BASE + path, headers=H(USER))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "FORBIDDEN"


@pytest.mark.parametrize("path,body", POST_ROUTES)
def test_post_routes_403_for_non_admin_even_with_valid_body(path, body):
    client, store, changes = make_app()
    r = client.post(BASE + path, json=body, headers=H(USER))
    assert r.status_code == 403
    assert store.audit == [] and changes == []


def test_non_admin_is_403_before_validation():
    client, *_ = make_app()
    assert client.post(BASE + "/users/entitlement", json={"junk": 1}, headers=H(USER)).status_code == 403


def test_admin_ok_and_masked_actor():
    client, *_ = make_app()
    r = client.get(BASE + "/me", headers=H())
    assert r.status_code == 200 and r.json()["admin"] == "0912***0009"


def test_empty_admin_list_denies_everyone():
    client, *_ = make_app(admins=set())
    assert client.get(BASE + "/me", headers=H()).status_code == 403


def test_rate_limit_429_with_retry_after(monkeypatch):
    client, *_ = make_app()

    async def deny(scope, key, limit):
        return False, 42

    monkeypatch.setattr(chat_auth, "acheck_limit", deny)
    r = client.get(BASE + "/me", headers=H())
    assert r.status_code == 429 and r.headers["retry-after"] == "42"


def test_rate_limit_buckets_are_separate():
    client, *_ = make_app()
    for _ in range(3):
        assert client.get(BASE + "/me", headers=H()).status_code == 200
    assert chat_auth.check_limit("adminc-w", ADMIN, 120)[0]  # the write bucket was not consumed by reads


def test_user_ref_formula_matches_smartjudge_module():
    from output_apps.generated_modules.smartjudge import smartjudge_module as mod

    for ident in ("09120000001", "em_0123456789abcdef"):
        assert admin_api.hashed_user_ref(ident) == mod._hashed_user_ref(ident)


def test_router_is_mounted_in_smartjudge_and_admin_phones_are_shared():
    from output_apps.generated_modules.smartjudge import smartjudge_module as mod

    from fastapi import FastAPI

    app = FastAPI()  # newer FastAPI keeps included routers lazy; the app's OpenAPI lists every path
    app.include_router(mod.router)
    paths = set(app.openapi().get("paths", {}))
    assert "/api/v1/apps/judge/admin/console/dashboard" in paths
    assert "/api/v1/apps/judge/admin/console/users/entitlement" in paths


# ------------------------------------------------------------------ validation (extra=forbid)
@pytest.mark.parametrize("body", [
    {"user_ref": "a" * 16, "action": "revoke", "reason": "abc", "tenant": "other"},      # extra field
    {"user_ref": "a" * 16, "action": "revoke"},                                           # no reason
    {"user_ref": "a" * 16, "action": "revoke", "reason": "ab"},                           # reason too short
    {"user_ref": "09120000001", "action": "revoke", "reason": "abc"},                     # not a user_ref
    {"user_ref": "A" * 16, "action": "revoke", "reason": "abc"},
    {"user_ref": "a" * 16, "action": "delete", "reason": "abc"},
    {"user_ref": "a" * 16, "action": "grant", "reason": "abc"},                           # grant without plan
    {"user_ref": "a" * 16, "action": "grant", "plan_type": "ROOT", "reason": "abc"},      # unknown plan
    {"user_ref": "a" * 16, "action": "grant", "plan_type": "SJ_PRO_MONTHLY", "days": 0, "reason": "abc"},
    {"user_ref": "a" * 16, "action": "grant", "plan_type": "SJ_PRO_MONTHLY", "days": 99999, "reason": "abc"},
    {"user_ref": "a" * 16, "action": "extend", "reason": "abc"},                          # extend without days
    {"user_ref": "a" * 16, "action": "extend", "days": 5, "plan_type": "SJ_PRO_MONTHLY", "reason": "abc"},
    {"user_ref": "a" * 16, "action": "revoke", "days": 3, "reason": "abc"},
])
def test_entitlement_body_rejected(body):
    client, store, changes = make_app()
    assert client.post(BASE + "/users/entitlement", json=body, headers=H()).status_code == 422
    assert store.audit == [] and changes == []


@pytest.mark.parametrize("path,body", [
    ("/payments/match-crypto", {"track_id": "USDT_" + "a" * 32, "tx_hash": "a" * 64, "reason": "abc", "x": 1}),
    ("/payments/match-crypto", {"track_id": "1234", "tx_hash": "a" * 64, "reason": "abc"}),
    ("/payments/match-crypto", {"track_id": "USDT_" + "a" * 32, "tx_hash": "zz", "reason": "abc"}),
    ("/payments/reverify", {"track_id": "USDT_" + "a" * 32, "reason": "abc"}),
    ("/payments/reverify", {"track_id": "12 34; rm", "reason": "abc"}),
    ("/research", {"query": "x"}),
    ("/research", {"query": "valid long query here", "max_sources": 99}),
    ("/research", {"query": "valid long query here", "report_type": "evil"}),
    ("/site-check", {"url": "https://example.com/", "extra": 1}),
    ("/agents/tasks", {"slug": "--evil", "task": "do something useful"}),
    ("/agents/tasks", {"slug": "a b c", "task": "do something useful"}),
    ("/agents/tasks", {"slug": "good-slug", "task": "short"}),
    ("/agents/tasks", {"slug": "good-slug", "task": "do something useful", "scopes": ["../etc"]}),
    ("/agents/tasks", {"slug": "good-slug", "task": "do something useful", "scopes": ["/etc/passwd"]}),
    ("/agents/tasks", {"slug": "good-slug", "task": "do something useful", "scopes": ["a; rm -rf /"]}),
    ("/agents/tasks", {"slug": "good-slug", "task": "do something useful", "scopes": ["--public"]}),
    ("/agents/tasks", {"slug": "good-slug", "task": "do something useful", "ladder": ["bash"]}),
    ("/agents/tasks", {"slug": "good-slug", "task": "do something useful", "ladder": ["free", "free"]}),
    ("/agents/tasks", {"slug": "good-slug", "task": "do something useful", "cmd": "ls"}),
    ("/marketing/decision", {"post_id": 0, "decision": "approve"}),
    ("/marketing/decision", {"post_id": 1, "decision": "publish"}),
])
def test_other_bodies_rejected_with_422(path, body):
    client, *_ = make_app()
    assert client.post(BASE + path, json=body, headers=H()).status_code == 422


# ------------------------------------------------------------------ entitlement grant + audit
def test_grant_writes_audit_and_clears_cache():
    client, store, changes = make_app()
    ref = admin_api.hashed_user_ref(USER)
    r = client.post(BASE + "/users/entitlement", headers=H(), json={
        "user_ref": ref, "action": "grant", "plan_type": "SJ_PRO_MONTHLY", "reason": "compensation for outage"})
    assert r.status_code == 200
    assert store.entitlements[ref]["plan_type"] == "SJ_PRO_MONTHLY" and store.entitlements[ref]["days"] == 30
    (row,) = store.audit
    assert row["actor"] == "0912***0009" and row["action"] == "entitlement_grant"
    assert row["target"] == ref and row["reason"] == "compensation for outage"
    assert changes == [1]


def test_trial_grant_defaults_to_seven_days():
    client, store, _ = make_app()
    ref = "b" * 16
    client.post(BASE + "/users/entitlement", headers=H(), json={
        "user_ref": ref, "action": "grant", "plan_type": "7_DAYS_TRIAL", "reason": "trial for lawyer"})
    assert store.entitlements[ref]["days"] == 7


def test_revoke_and_extend_errors_map_to_http():
    client, store, changes = make_app()
    ref = "c" * 16
    r = client.post(BASE + "/users/entitlement", headers=H(), json={"user_ref": ref, "action": "extend", "days": 5, "reason": "why"})
    assert r.status_code == 404 and r.json()["detail"]["code"] == "NO_ENTITLEMENT"
    r = client.post(BASE + "/users/entitlement", headers=H(), json={"user_ref": ref, "action": "revoke", "reason": "why"})
    assert r.status_code == 409
    assert store.audit == [] and changes == []


def test_user_lookup_phone_email_and_errors():
    client, store, _ = make_app()
    ref = admin_api.hashed_user_ref(USER)
    store.entitlements[ref] = {"plan_type": "SJ_PRO_MONTHLY", "active": True, "status": "ADMIN_GRANT"}
    r = client.get(BASE + "/users/lookup", params={"q": USER}, headers=H())
    assert r.status_code == 200
    body = r.json()
    assert body["user_ref"] == ref and body["level"] == "pro" and body["identity_hint"] == "0912***0001"
    assert "SJ_PRO_MONTHLY" in body["grantable_plans"]
    assert client.get(BASE + "/users/lookup", params={"q": "12345"}, headers=H()).status_code == 400
    assert client.get(BASE + "/users/lookup", params={"q": "nobody@example.com"}, headers=H()).status_code == 404
    ok = client.get(BASE + "/users/lookup", params={"q": "known@example.com"}, headers=H()).json()
    assert ok["kind"] == "email" and ok["user_ref"] == admin_api.hashed_user_ref("em_0123456789abcdef")
    assert client.get(BASE + "/users/lookup", params={"q": "x"}, headers=H()).status_code == 422


def test_user_lookup_reads_usage_counter_without_incrementing():
    client, *_ = make_app()
    chat_auth.incr(f"rl:chat-day:free:{USER}", 3600)
    chat_auth.incr(f"rl:chat-day:free:{USER}", 3600)
    for _ in range(2):
        used = client.get(BASE + "/users/lookup", params={"q": USER}, headers=H()).json()["usage_today"]["used_by_level"]
        assert used == {"free": 2}


# ------------------------------------------------------------------ payments
def test_payments_list_masks_phone_and_converts_toman():
    client, *_ = make_app()
    row = client.get(BASE + "/payments", headers=H()).json()["orders"][0]
    assert row["phone"] == "0912***0009" and row["amount_toman"] == 490_000
    assert client.get(BASE + "/payments?status=drop", headers=H()).status_code == 422
    assert client.get(BASE + "/payments?limit=999", headers=H()).status_code == 422


def _crypto_fixture(amount="10.003417", status="pending", value_micro=10_003_417, address=OUR_ADDRESS):
    client_store = {}
    now = dt.datetime.now(dt.timezone.utc)
    track = "USDT_" + "a" * 32
    tx = "b" * 64
    store = FakeStore()
    store.orders[track] = {"track_id": track, "plan_type": "SJ_PRO_MONTHLY", "status": status, "method": "usdt_trc20",
                          "amount_usdt": amount, "address": address, "user_ref": "d" * 16,
                          "created_at": (now - dt.timedelta(hours=3)).isoformat()}
    store.unmatched[tx] = {"tx_hash": tx, "sender": "TSENDER", "value_micro": value_micro,
                           "block_ts": (now - dt.timedelta(hours=1)).isoformat(), "reason": "no_open_invoice", "resolved": False}
    chain = [{"transaction_id": tx, "type": "Transfer", "from": "TSENDER", "to": OUR_ADDRESS, "value": str(value_micro),
              "block_timestamp": int((now - dt.timedelta(hours=1)).timestamp() * 1000),
              "token_info": {"address": cps.USDT_TRC20_CONTRACT, "decimals": 6}}]
    return store, track, tx, chain, client_store


def test_match_crypto_activates_after_revalidation():
    store, track, tx, chain, _ = _crypto_fixture(status="expired")
    activated = []
    client, _, changes = make_app(store, fetch_transfers=lambda addr, since: chain,
                                  activate_fn=lambda ref, plan: activated.append((ref, plan)) or {"persisted": True})
    r = client.post(BASE + "/payments/match-crypto", headers=H(), json={"track_id": track, "tx_hash": tx, "reason": "late payment"})
    assert r.status_code == 200, r.text
    assert r.json()["activated"] is True and activated == [("d" * 16, "SJ_PRO_MONTHLY")]
    assert store.settled and store.audit[-1]["action"] == "crypto_match" and changes == [1]


def test_match_crypto_activation_failure_is_flagged_not_hidden():
    store, track, tx, chain, _ = _crypto_fixture()
    client, *_ = make_app(store, fetch_transfers=lambda a, s: chain, activate_fn=lambda r, p: {"persisted": False})
    body = client.post(BASE + "/payments/match-crypto", headers=H(), json={"track_id": track, "tx_hash": tx, "reason": "late"}).json()
    assert body["activation_pending"] is True
    assert any(a["action"] == "crypto_match_activation_pending" for a in store.audit)


@pytest.mark.parametrize("kw,code", [
    ({"value_micro": 9_999_999}, "AMOUNT_MISMATCH"),
    ({"address": "TOtherAddress"}, "ADDRESS_MISMATCH"),
    ({"status": "paid"}, "BAD_ORDER_STATUS"),
])
def test_match_crypto_refuses_mismatches(kw, code):
    store, track, tx, chain, _ = _crypto_fixture(**kw)
    client, *_ = make_app(store, fetch_transfers=lambda a, s: chain, activate_fn=lambda r, p: pytest.fail("activated"))
    r = client.post(BASE + "/payments/match-crypto", headers=H(), json={"track_id": track, "tx_hash": tx, "reason": "late"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == code
    assert store.settled == []


def test_match_crypto_needs_the_chain_to_agree():
    store, track, tx, chain, _ = _crypto_fixture()
    for bad in ([], [{**chain[0], "to": "TSomeoneElse"}], [{**chain[0], "value": "10003418"}],
                [{**chain[0], "token_info": {"address": "TFakeToken", "decimals": 6}}]):
        client, *_ = make_app(store, fetch_transfers=lambda a, s, bad=bad: bad,
                              activate_fn=lambda r, p: pytest.fail("activated"))
        r = client.post(BASE + "/payments/match-crypto", headers=H(), json={"track_id": track, "tx_hash": tx, "reason": "late"})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "CHAIN_MISMATCH"
    assert store.settled == []


def test_match_crypto_chain_unreachable_is_502_and_changes_nothing():
    store, track, tx, chain, _ = _crypto_fixture()

    def boom(addr, since):
        raise OSError("down")

    client, *_ = make_app(store, fetch_transfers=boom)
    r = client.post(BASE + "/payments/match-crypto", headers=H(), json={"track_id": track, "tx_hash": tx, "reason": "late"})
    assert r.status_code == 502 and store.settled == []


def test_match_crypto_unknown_tx_or_order_and_disabled(monkeypatch):
    store, track, tx, chain, _ = _crypto_fixture()
    client, *_ = make_app(store, fetch_transfers=lambda a, s: chain)
    assert client.post(BASE + "/payments/match-crypto", headers=H(), json={
        "track_id": track, "tx_hash": "c" * 64, "reason": "late"}).status_code == 404
    assert client.post(BASE + "/payments/match-crypto", headers=H(), json={
        "track_id": "USDT_" + "f" * 32, "tx_hash": tx, "reason": "late"}).status_code == 404
    monkeypatch.delenv("CRYPTO_USDT_TRC20_ADDRESS")
    assert client.post(BASE + "/payments/match-crypto", headers=H(), json={
        "track_id": track, "tx_hash": tx, "reason": "late"}).status_code == 503


def test_reverify_zibal_audits_and_unknown_order():
    store = FakeStore()
    store.orders["123456"] = {"track_id": "123456", "method": "zibal", "status": "pending"}
    client, _, changes = make_app(store, zibal_verify=lambda t: {"status": "PAID", "message": "ok"})
    r = client.post(BASE + "/payments/reverify", headers=H(), json={"track_id": "123456", "reason": "customer called"})
    assert r.status_code == 200 and r.json()["verify_status"] == "PAID" and changes == [1]
    assert store.audit[-1]["action"] == "zibal_reverify" and store.audit[-1]["reason"] == "customer called"
    assert client.post(BASE + "/payments/reverify", headers=H(), json={"track_id": "999999", "reason": "x y"}).status_code == 404


def test_reverify_refuses_crypto_orders():
    store = FakeStore()
    store.orders["77777"] = {"track_id": "77777", "method": "usdt_trc20", "status": "pending"}
    client, *_ = make_app(store, zibal_verify=lambda t: pytest.fail("called zibal"))
    assert client.post(BASE + "/payments/reverify", headers=H(), json={"track_id": "77777", "reason": "x y"}).status_code == 400


# ------------------------------------------------------------------ dashboard / models / health
def _write_cost_log(path: Path, rows: list[dict]):
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


def _rec(minutes_ago, group="vip-pro", ok=True, tokens=50, cost=0.01, latency=900):
    ts = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=minutes_ago)
    return {"ts": ts.isoformat().replace("+00:00", "Z"), "model_group": group, "success": ok,
            "completion_tokens": tokens, "response_cost": cost, "latency_ms": latency}


def test_dashboard_numbers_margin_and_graceful_umami(tmp_path):
    _write_cost_log(tmp_path / "requests.jsonl", [_rec(60 * 24 * 40), _rec(60 * 24 * 3), _rec(20, ok=False), _rec(10)])  # chronological, like the real log
    client, *_ = make_app()
    body = client.get(BASE + "/dashboard", headers=H()).json()
    d7 = body["windows"]["d7"]
    assert d7["new_users"] == 3 and d7["active_users"] == 3 and d7["paid_orders"] == 3
    assert d7["questions_by_plan"] == {"free": 5, "basic": 0, "pro": 7, "premium": 0}
    assert d7["revenue_toman"] == 2_000_000 and d7["revenue_usdt"] == 10.003417
    assert d7["llm_calls"] == 3 and d7["llm_errors"] == 1 and d7["llm_cost_usd"] == 0.03
    assert d7["revenue_usd_equiv"] == round(10.003417 + 2_000_000 / 300_000, 2)
    assert d7["margin_usd"] == round(d7["revenue_usd_equiv"] - 0.03, 2)
    assert body["windows"]["d30"]["llm_calls"] == 3  # the 40-day-old record is outside every window
    assert body["subscriptions_by_level"] == {"free": 0, "basic": 1, "pro": 4, "premium": 0}
    assert body["umami"]["status"] == "not configured"


def test_cost_log_tail_reading_spans_blocks_and_stops_at_cutoff(tmp_path):
    path = tmp_path / "requests.jsonl"
    old = [_rec(60 * 24 * 90 + i) for i in range(20000)]  # ~1.8 MB of old lines
    new = [_rec(i % 50 + 1, group="g%d" % (i % 3)) for i in range(300)]
    _write_cost_log(path, old + new)
    assert path.stat().st_size > 2 * 1024 * 1024
    recs = hd.read_cost_records(path, time.time() - 86400)
    assert len(recs) == 300
    assert hd.read_cost_records(tmp_path / "missing.jsonl", 0) == []
    path.write_text("not json\n" + json.dumps(_rec(5)) + "\n\n{broken", encoding="utf-8")
    assert len(hd.read_cost_records(path, time.time() - 86400)) == 1


def test_group_stats_counts_empties_errors_and_fallbacks():
    recs = [{**_rec(5, tokens=0), "_ts": time.time() - 300}, {**_rec(5, ok=False), "_ts": time.time() - 300},
            {**_rec(5, group="private"), "_ts": time.time() - 300}]
    rows = {r["group"]: r for r in hd.group_stats(recs, time.time() - 3600, {"private"})}
    assert rows["vip-pro"]["calls"] == 2 and rows["vip-pro"]["empties"] == 1 and rows["vip-pro"]["errors"] == 1
    assert rows["private"]["is_fallback_target"] is True


def test_models_tab_mapping_fallbacks_and_bakeoff(tmp_path, monkeypatch):
    monkeypatch.delenv("SMARTJUDGE_LLM_GATEWAY_MODEL_PRO", raising=False)
    _write_cost_log(tmp_path / "requests.jsonl", [_rec(5), _rec(120)])
    client, *_ = make_app()
    body = client.get(BASE + "/models", headers=H()).json()
    by_tier = {m["tier"]: m for m in body["tier_mapping"]}
    assert by_tier["pro"]["group"] == "vip-pro" and by_tier["premium"]["group"] == "vip-premium"
    assert body["config_found"] is True and by_tier["pro"]["fallback_chain"]
    assert body["last_hour"][0]["calls"] == 1 and body["last_24h"][0]["calls"] == 2
    assert body["bakeoff"]["available"] is False and "model_bakeoff.py" in body["bakeoff"]["instructions"]
    (tmp_path / "bakeoff").mkdir()
    (tmp_path / "bakeoff" / "report.md").write_text("# report\n", encoding="utf-8")
    assert client.get(BASE + "/models", headers=H()).json()["bakeoff"]["markdown"] == "# report\n"


def test_health_collects_sources_without_failing(tmp_path, monkeypatch):
    def no_http(*a, **kw):  # the app has no Docker API access; containers come from the host snapshot
        raise AssertionError("no network call expected")

    monkeypatch.setattr(hd.httpx, "get", no_http)
    (tmp_path / "deploy").mkdir()
    (tmp_path / "deploy" / "autodeploy-last.json").write_text(json.dumps(
        {"time": "t", "target": "abc", "deployed_before": "def", "migrated": False, "result": "ok", "log": "/x"}))
    old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=2)).isoformat()
    (tmp_path / "host_status.json").write_text(json.dumps({"generated_at": old, "timers": [], "containers": [
        {"name": "roxira_app_prod", "image": "x", "state": "running", "status": "Up 3 hours (healthy)", "healthy": True},
        {"name": "roxira_bad", "image": "y", "state": "running", "status": "Up (unhealthy)", "healthy": False}]}))
    client, *_ = make_app()
    body = client.get(BASE + "/health", headers=H()).json()
    names = {c["name"]: c for c in body["containers"]["containers"]}
    assert names["roxira_bad"]["healthy"] is False and names["roxira_app_prod"]["healthy"] is True
    assert "Env" not in json.dumps(body) and "SECRET" not in json.dumps(body)
    assert body["last_deploy"]["result"] == "ok" and "log" not in body["last_deploy"]
    assert body["host"]["stale"] is True


# ------------------------------------------------------------------ research
def test_research_job_lifecycle_and_isolation():
    async def fake_research(query, report_type, max_sources):
        await asyncio.sleep(0.05)
        return {"report_markdown": "# گزارش", "sources": [{"url": "https://ekhtebar.ir/x", "title": "t"}]}

    client, *_ = make_app(research_fn=fake_research, admins={ADMIN, USER})
    client.__enter__()  # one event loop for the whole test, as in production
    job = client.post(BASE + "/research", headers=H(), json={"query": "مهلت تجدیدنظر چند روز است"}).json()["job_id"]
    for _ in range(100):
        state = client.get(f"{BASE}/research/{job}", headers=H()).json()
        if state["state"] == "done":
            break
        time.sleep(0.02)
    assert state["state"] == "done" and state["result"]["sources"][0]["url"].startswith("https://")
    assert client.get(f"{BASE}/research/{job}", headers=H(USER)).status_code == 404  # another admin cannot read it
    assert client.get(f"{BASE}/research/not~valid", headers=H()).status_code == 404


def test_research_rejects_private_data_and_caps_concurrency():
    async def slow(query, report_type, max_sources):
        await asyncio.sleep(5)

    client, *_ = make_app(research_fn=slow)
    client.__enter__()
    for private in ("پرونده شماره 09123456789 چیست", "کد ملی 0012345678 را بررسی کن"):
        assert client.post(BASE + "/research", headers=H(), json={"query": private}).status_code == 400
    assert client.post(BASE + "/research", headers=H(), json={"query": "first public question"}).status_code == 200
    assert client.post(BASE + "/research", headers=H(), json={"query": "second public question"}).status_code == 200
    r = client.post(BASE + "/research", headers=H(), json={"query": "third public question"})
    assert r.status_code == 429 and r.headers["retry-after"] == "60"


def test_research_service_failure_is_reported_not_raised():
    async def boom(query, report_type, max_sources):
        raise RuntimeError("secret internal text")

    client, *_ = make_app(research_fn=boom)
    client.__enter__()
    job = client.post(BASE + "/research", headers=H(), json={"query": "a public question"}).json()["job_id"]
    for _ in range(100):
        state = client.get(f"{BASE}/research/{job}", headers=H()).json()
        if state["state"] != "running" and state["state"] != "queued":
            break
        time.sleep(0.02)
    assert state["state"] == "error" and "secret internal text" not in json.dumps(state)


# ------------------------------------------------------------------ site check
def test_site_check_endpoint_maps_refusal_to_400():
    def refuse(url):
        raise sc.SiteCheckError("no")

    client, store, _ = make_app(site_check_fn=refuse)
    assert client.post(BASE + "/site-check", headers=H(), json={"url": "http://127.0.0.1/"}).status_code == 400
    client, store, _ = make_app(site_check_fn=lambda u: {"requested": u, "status": 200})
    body = client.post(BASE + "/site-check", headers=H(), json={"url": "https://example.com/"}).json()
    assert body["status"] == "ok" and body["report"]["status"] == 200
    assert store.audit[-1]["action"] == "site_check"


@pytest.mark.parametrize("url", ["ftp://example.com/", "file:///etc/passwd", "http://user:pw@example.com/",
                                 "https://example.com:8443/", "http://example.com:22/", "javascript:alert(1)",
                                 "https://exa mple.com/", "https:///nohost", "http://example.com/\r\nHost: evil"])
def test_parse_url_refuses(url):
    with pytest.raises(sc.SiteCheckError):
        sc.parse_url(url)


@pytest.mark.parametrize("answer", ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.0.9", "169.254.169.254",
                                    "0.0.0.0", "::1", "fe80::1", "fc00::1", "::ffff:10.0.0.1", "100.64.0.1"])
def test_resolve_public_refuses_internal_addresses(monkeypatch, answer):
    monkeypatch.setattr(sc.socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", (answer, 0))])
    with pytest.raises(sc.SiteCheckError):
        sc.resolve_public("evil.example")


def test_resolve_public_refuses_if_any_answer_is_internal(monkeypatch):
    monkeypatch.setattr(sc.socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 0)), (2, 1, 6, "", ("10.0.0.1", 0))])
    with pytest.raises(sc.SiteCheckError):
        sc.resolve_public("rebind.example")
    monkeypatch.setattr(sc.socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 0))])
    assert sc.resolve_public("example.com") == "93.184.216.34"


HTML = b"""<!doctype html><html lang="fa"><head><title>Ghazi Houshmand legal assistant</title>
<meta name="description" content="A description that is long enough to be a decent snippet for search results page.">
<meta name="viewport" content="width=device-width"><link rel="canonical" href="https://example.com/">
<link rel="alternate" hreflang="en" href="https://example.com/en"><meta property="og:title" content="t">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","founder":{"@type":"Person"}}</script>
</head><body><h1>Hi</h1><img src=a.png><img src=b.png alt="x"></body></html>"""


def test_analyze_extracts_seo_basics():
    res = {"status": 200, "headers": {"content-type": "text/html; charset=utf-8", "content-encoding": "gzip",
                                      "strict-transport-security": "max-age=1"}, "body": HTML,
           "ttfb_ms": 120, "total_ms": 150, "truncated": False}
    out = sc.analyze(res, "https://example.com/")
    seo = out["seo"]
    assert seo["title"].startswith("Ghazi") and seo["canonical"] == "https://example.com/" and seo["lang"] == "fa"
    assert seo["hreflang"] == [{"lang": "en", "href": "https://example.com/en"}]
    assert seo["structured_data_types"] == ["Organization", "Person"]
    assert seo["h1_count"] == 1 and seo["images"] == 2 and seo["images_without_alt"] == 1
    levels = {c["name"]: c["level"] for c in out["checks"]}
    assert levels["canonical"] == "ok" and levels["image-alt"] == "warn" and levels["security-headers"] == "warn"


def test_check_site_obeys_robots_and_fetches_once(monkeypatch):
    monkeypatch.setattr(sc.socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 0))])
    calls = []

    def fake_fetch(parts, path, ip, limit):
        calls.append(path)
        assert ip == "93.184.216.34"
        if path == "/robots.txt":
            return {"status": 200, "headers": {}, "body": b"User-agent: RoxiraBot\nDisallow: /private\n", "ttfb_ms": 1,
                    "total_ms": 1, "truncated": False}
        return {"status": 200, "headers": {"content-type": "text/html"}, "body": HTML, "ttfb_ms": 5, "total_ms": 6, "truncated": False}

    monkeypatch.setattr(sc, "_fetch", fake_fetch)
    blocked = sc.check_site("https://example.com/private/page")
    assert blocked["fetched"] is False and calls == ["/robots.txt"]
    calls.clear()
    ok = sc.check_site("https://example.com/")
    assert ok["fetched"] is True and calls == ["/robots.txt", "/"] and ok["user_agent"] == "RoxiraBot/1.0 (+https://ghazihoushmand.ir)"


@pytest.mark.parametrize("status,allowed", [(404, True), (500, False), (301, False)])
def test_robots_status_handling(monkeypatch, status, allowed):
    monkeypatch.setattr(sc, "_fetch", lambda *a: {"status": status, "headers": {}, "body": b"", "ttfb_ms": 1, "total_ms": 1, "truncated": False})
    assert sc.robots_allows(sc.parse_url("https://example.com/"), "93.184.216.34", "/")[0] is allowed


def test_site_check_never_sets_evasion_headers():
    src = (Path(sc.__file__)).read_text(encoding="utf-8")
    for banned in ("curl_cffi", "cloudscraper", "undetected", "playwright", "selenium", "2captcha", "ja3", "impersonate"):
        assert banned not in src.lower()
    assert sc.USER_AGENT == "RoxiraBot/1.0 (+https://ghazihoushmand.ir)"


# ------------------------------------------------------------------ agent tasks: the REAL taskq.py in a temp dir
def test_queue_task_runs_taskq_with_fixed_argv_and_writes_the_task_file(tmp_path):
    evil = "fix the bug $(touch /tmp/pwned) `id` ; rm -rf / && echo $HOME \"quoted\" 'single' --public"
    client, *_ = make_app()  # default queue_task_fn = the real one
    r = client.post(BASE + "/agents/tasks", headers=H(), json={
        "slug": "fix-bug-1", "task": evil, "scopes": ["output_apps/generated_modules/smartjudge", "docs"],
        "ladder": ["ds-flash", "strong"], "public": False, "priority": 3})
    assert r.status_code == 200, r.text
    tid = r.json()["task_id"]
    db = sqlite3.connect(tmp_path / "agents" / "taskq.db")
    db.row_factory = sqlite3.Row
    row = db.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
    assert row["slug"] == "fix-bug-1" and row["status"] == "queued" and row["priority"] == 3 and row["public"] == 0
    assert json.loads(row["scopes"]) == ["output_apps/generated_modules/smartjudge", "docs"]
    assert json.loads(row["ladder"]) == ["ds-flash", "strong"]
    task_file = Path(row["task_file"])
    assert task_file.parent == (tmp_path / "agents" / "admin-tasks").resolve() and evil in task_file.read_text()
    assert not Path("/tmp/pwned").exists()
    listing = client.get(BASE + "/agents/tasks", headers=H()).json()
    assert listing["available"] and listing["tasks"][0]["slug"] == "fix-bug-1" and listing["counts"] == {"queued": 1}


def test_queue_task_last_line_of_defence_and_public_flag(tmp_path):
    with pytest.raises(ValueError):
        hd.queue_task(slug="-x", task="long enough task text", scopes=[], ladder=["free"], public=False, priority=0, actor="a")
    with pytest.raises(ValueError):
        hd.queue_task(slug="ok-slug", task="long enough task text", scopes=["../x"], ladder=["free"], public=False, priority=0, actor="a")
    tid = hd.queue_task(slug="pub-task", task="long enough task text", scopes=[], ladder=["free"], public=True, priority=0, actor="a")
    db = sqlite3.connect(tmp_path / "agents" / "taskq.db")
    assert db.execute("SELECT public FROM tasks WHERE id=?", (tid,)).fetchone()[0] == 1


def test_queue_failure_is_502(monkeypatch):
    def fail(**kw):
        raise RuntimeError("taskq.py is not mounted into the app container")

    client, *_ = make_app(queue_task_fn=fail)
    r = client.post(BASE + "/agents/tasks", headers=H(), json={"slug": "abc-task", "task": "do something useful"})
    assert r.status_code == 502


def test_recent_tasks_when_nothing_is_mounted():
    client, *_ = make_app()
    assert client.get(BASE + "/agents/tasks", headers=H()).json()["available"] is False


# ------------------------------------------------------------------ marketing: the REAL mkt_store in a temp dir
def _mkt_store(tmp_path):
    (tmp_path / "mkt").mkdir(exist_ok=True)
    store = hd._load_mkt_store().Store(str(tmp_path / "mkt" / "marketing.db"))
    ids = {}
    for status in ("draft", "proposed", "approved", "published"):
        pid = store.add_post(brand="ghazi", platform="telegram", campaign="c", source_id=status, caption=f"post {status}",
                             hashtags=["#a"], scheduled_at=int(time.time()))
        if status != "draft":
            assert store.transition("posts", pid, "proposed")
        if status in ("approved", "published"):
            assert store.transition("posts", pid, "approved")
        if status == "published":
            assert store.transition("posts", pid, "publishing") and store.transition("posts", pid, "published")
        ids[status] = pid
    store.db.close()
    return ids


def test_marketing_lists_pending_and_published(tmp_path):
    ids = _mkt_store(tmp_path)
    client, *_ = make_app()
    body = client.get(BASE + "/marketing", headers=H()).json()
    assert {d["status"] for d in body["drafts"]} == {"draft", "proposed"} and body["published"][0]["id"] == ids["published"]
    assert body["available"] and body["paused"] is False


def test_marketing_decisions_follow_mkt_py_transitions(tmp_path):
    ids = _mkt_store(tmp_path)
    client, store, _ = make_app()

    def decide(pid, d):
        return client.post(BASE + "/marketing/decision", headers=H(), json={"post_id": pid, "decision": d, "reason": "ok"})

    assert decide(ids["proposed"], "approve").status_code == 200
    assert decide(ids["draft"], "reject").status_code == 200
    assert decide(ids["approved"], "approve").status_code == 409      # already approved: not a pending draft
    assert decide(ids["published"], "reject").status_code == 409      # terminal state never changes
    assert decide(99999, "approve").status_code == 409
    db = sqlite3.connect(tmp_path / "mkt" / "marketing.db")
    states = dict(db.execute("SELECT id, status FROM posts").fetchall())
    assert states[ids["proposed"]] == "approved" and states[ids["draft"]] == "rejected"
    assert states[ids["published"]] == "published"
    assert [a["action"] for a in store.audit] == ["mkt_approve", "mkt_reject"]


def test_marketing_draft_approve_passes_through_proposed(tmp_path):
    ids = _mkt_store(tmp_path)
    client, *_ = make_app()
    assert client.post(BASE + "/marketing/decision", headers=H(), json={"post_id": ids["draft"], "decision": "approve"}).status_code == 200
    db = sqlite3.connect(tmp_path / "mkt" / "marketing.db")
    assert db.execute("SELECT status FROM posts WHERE id=?", (ids["draft"],)).fetchone()[0] == "approved"


def test_marketing_unavailable_without_db():
    client, *_ = make_app()
    body = client.get(BASE + "/marketing", headers=H()).json()
    assert body["available"] is False
    assert client.post(BASE + "/marketing/decision", headers=H(), json={"post_id": 1, "decision": "approve"}).status_code == 409
