"""Tests for the Twenty CRM sync. No network and no Postgres: a fake Twenty client and a fake DB connection."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

CRM_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CRM_DIR))

import sync_to_twenty as s  # noqa: E402

PHONE = "09121234567"


class FakeTwenty:
    """In-memory Twenty: list_all / create / update, records get incrementing ids."""

    def __init__(self):
        self.store: dict[str, dict[str, dict]] = {}
        self.calls: list[tuple] = []

    def list_all(self, obj):
        return [dict(r) for r in self.store.get(obj, {}).values()]

    def create(self, obj, body):
        self.calls.append(("create", obj))
        rid = f"{obj}-{len(self.store.setdefault(obj, {})) + 1}"
        self.store[obj][rid] = {"id": rid, **body}
        return {"id": rid}

    def update(self, obj, rec_id, body):
        self.calls.append(("update", obj))
        self.store[obj][rec_id].update(body)
        return {"id": rec_id}


def _data():
    ref = s.user_ref_for_phone("09121234567")
    return {
        "people": {
            ref: {"ref": ref, "email": None, "phone": "9121234567", "plan": "pro",
                  "plan_status": "active", "expires_at": "2026-11-20T00:00:00+00:00", "created_at": None},
            "em1": {"ref": "em1", "email": "a@b.ir", "phone": None, "plan": None,
                    "plan_status": None, "expires_at": None, "created_at": None},
        },
        "orders": [
            {"track_id": "T1", "plan": "pro", "amount_rial": 1000000, "method": "zibal",
             "amount_usdt": None, "ref": ref, "paid_at": "2026-10-19T10:00:00+00:00"},
            {"track_id": "T2", "plan": "premium", "amount_rial": 0, "method": "usdt_trc20",
             "amount_usdt": "29.013", "ref": "em1", "paid_at": "2026-10-20T10:00:00+00:00"},
            {"track_id": "T3", "plan": "basic", "amount_rial": 500, "method": "zibal",
             "amount_usdt": None, "ref": None, "paid_at": None},
        ],
        "tickets": [
            {"code": "TK-1", "name": "Ali", "contact": PHONE, "department": "billing",
             "subject": "Receipt", "message": "Need receipt", "status": "OPEN", "ref": ref,
             "created_at": "2026-10-18T00:00:00"},
        ],
        "errors": [],
    }


def test_norm_phone_variants():
    assert s.norm_phone("09121234567") == "9121234567"
    assert s.norm_phone("+98 912 123 4567") == "9121234567"
    assert s.norm_phone("00989121234567") == "9121234567"
    assert s.norm_phone("") is None and s.norm_phone(None) is None


def test_user_ref_is_stable_16_hex():
    ref = s.user_ref_for_phone(PHONE)
    assert ref == s.user_ref_for_phone(PHONE) and len(ref) == 16


def test_payloads():
    d = _data()
    p = s.person_payload(d["people"]["em1"])
    assert p["emails"] == {"primaryEmail": "a@b.ir"} and p["plan"] == "free" and "phones" not in p
    usdt = s.opportunity_payload(d["orders"][1], "pid")
    assert usdt["amount"] == {"amountMicros": 29_013_000, "currencyCode": "USD"}
    assert usdt["pointOfContactId"] == "pid"
    irr = s.opportunity_payload(d["orders"][0], None)
    assert irr["amount"] == {"amountMicros": 1_000_000_000_000, "currencyCode": "IRR"}
    assert "pointOfContactId" not in irr
    assert s.note_payload(d["tickets"][0])["title"].startswith("[rx-ticket:TK-1] ")


def test_dry_run_never_calls_client():
    fake = FakeTwenty()
    stats = s.sync(_data(), fake, apply=False)
    assert fake.calls == []
    assert stats["people"]["create"] == 2 and stats["opportunities"]["create"] == 3
    assert stats["notes"]["create"] == 1


def test_dry_run_without_client():
    stats = s.sync(_data(), None, apply=False)
    assert stats["people"]["create"] == 2


def test_apply_creates_then_second_run_is_idempotent():
    fake = FakeTwenty()
    first = s.sync(_data(), fake, apply=True)
    assert first["people"]["create"] == 2 and first["opportunities"]["create"] == 3
    assert len(fake.store["people"]) == 2 and len(fake.store["opportunities"]) == 3
    assert len(fake.store["notes"]) == 1 and len(fake.store["noteTargets"]) == 1
    opp_t1 = next(r for r in fake.store["opportunities"].values() if r["externalId"] == "T1")
    ref = s.user_ref_for_phone(PHONE)
    person_id = next(r["id"] for r in fake.store["people"].values() if r["externalId"] == ref)
    assert opp_t1["pointOfContactId"] == person_id
    fake.calls.clear()
    second = s.sync(_data(), fake, apply=True)
    assert fake.calls == []
    assert second["people"] == {"create": 0, "update": 0, "same": 2}
    assert second["opportunities"]["same"] == 3 and second["notes"]["same"] == 1


def test_changed_plan_updates_and_extra_remote_fields_ignored():
    fake = FakeTwenty()
    s.sync(_data(), fake, apply=True)
    for rec in fake.store["people"].values():  # Twenty adds fields we never send
        rec["createdAt"] = "x"
        rec["name"]["middleName"] = ""
    d = _data()
    ref = s.user_ref_for_phone(PHONE)
    d["people"][ref]["plan"] = "premium"
    fake.calls.clear()
    stats = s.sync(d, fake, apply=True)
    assert stats["people"] == {"create": 0, "update": 1, "same": 1}
    assert fake.calls == [("update", "people")]


def test_iso_datetimes_with_z_suffix_count_as_same():
    assert s._same({"t": "2026-11-20T00:00:00+00:00"}, {"t": "2026-11-20T00:00:00.000Z"})
    assert not s._same({"t": "2026-11-20T00:00:00+00:00"}, {"t": "2026-11-21T00:00:00Z"})


# ------------------------------------------------------------------ extraction with a fake connection
class FakeConn:
    def __init__(self, results: dict[str, list[tuple]], broken: tuple[str, ...] = ()):
        self.results, self.broken = results, broken
        self.rollbacks = 0

    def cursor(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        for key in self.broken:
            if key in sql:
                raise RuntimeError("relation does not exist")
        self._rows = next((v for k, v in self.results.items() if k in sql), [])

    def fetchall(self):
        return self._rows

    def rollback(self):
        self.rollbacks += 1


def test_extract_joins_orders_entitlements_and_tickets():
    ref = s.user_ref_for_phone(PHONE)
    conn = FakeConn({
        "FROM email_accounts": [("em1", "a@b.ir", "0935 000 0000", None)],
        "FROM chat_conversations": [(PHONE,)],
        "information_schema": [("method",), ("amount_usdt",)],
        "FROM payment_orders": [("T1", "pro", 1000000, None, None, ref, PHONE, None, None),
                                ("T2", "premium", 0, "usdt_trc20", "29.0", "em1", None, None, None)],
        "FROM user_entitlements": [(ref, "pro", "active", None), (PHONE, "pro", "active", None)],
        "FROM support_tickets": [("TK-1", "Ali", "a@B.ir", "billing", "Hi", "msg", "OPEN", None)],
    })
    out = s.extract(conn)
    assert set(out["people"]) == {"em1", ref}
    assert out["people"][ref]["plan"] == "pro" and out["people"]["em1"]["phone"] == "9350000000"
    assert [o["ref"] for o in out["orders"]] == [ref, "em1"]
    assert out["orders"][0]["method"] == "zibal"
    assert out["tickets"][0]["ref"] == "em1"


def test_extract_survives_missing_tables():
    conn = FakeConn({}, broken=("support_tickets", "user_entitlements"))
    out = s.extract(conn)
    assert out["tickets"] == [] and len(out["errors"]) == 2 and conn.rollbacks == 2


def test_main_apply_refuses_without_key(monkeypatch):
    monkeypatch.delenv("TWENTY_API_KEY", raising=False)
    assert s.main(["--apply"]) == 2


def test_http_client_create_parses_wrapped_record(monkeypatch):
    c = s.HttpTwentyClient("http://x", "k")
    monkeypatch.setattr(c, "_req", lambda m, p, b=None: {"data": {"createPerson": {"id": "abc"}}})
    assert c.create("people", {}) == {"id": "abc"}
    monkeypatch.setattr(c, "_req", lambda m, p, b=None: {"data": {}})
    assert c.create("people", {}) == {"id": None}


def test_http_client_paginates(monkeypatch):
    pages = iter([
        {"data": {"people": [{"id": "1"}]}, "pageInfo": {"hasNextPage": True, "endCursor": "c1"}},
        {"data": {"people": [{"id": "2"}]}, "pageInfo": {"hasNextPage": False}},
    ])
    seen = []
    c = s.HttpTwentyClient("http://x", "k")
    monkeypatch.setattr(c, "_req", lambda m, p, b=None: (seen.append(p), next(pages))[1])
    assert [r["id"] for r in c.list_all("people")] == ["1", "2"]
    assert "starting_after=c1" in seen[1]
