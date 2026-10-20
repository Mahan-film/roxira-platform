#!/usr/bin/env python3
"""Nightly, idempotent sync of Smart Judge customers into Twenty CRM (internal dogfooding).

Reads our Postgres (read-only) and upserts into Twenty over its REST API:
  People         one per Smart Judge user (phone and/or email account); plan + expiry as custom fields
  Opportunities  one per PAID order (amount, method, date), linked to the person
  Notes          one per support ticket, linked to the person when the contact matches

Dry-run by default: prints what would be created/updated and never calls Twenty. Pass --apply to write.
Env: TWENTY_API_KEY (required with --apply), TWENTY_API_URL (default http://roxira_twenty_crm:3000),
plus the usual DATABASE_URL / POSTGRES_* of the app container. The CRM is internal, so contact phone
and email are stored in clear. Idempotency: People/Opportunities carry a custom text field
``externalId`` (stable: user_ref / order track_id); Notes carry a ``[rx-ticket:CODE]`` title marker.
Runs inside the app container (stdin), see docs/ops/CRM_SYNC.md. Stdlib + psycopg only.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import logging
import os
import re
import sys
import urllib.error
import urllib.request
from typing import Any, Protocol

log = logging.getLogger("crm_sync")
DEFAULT_URL = "http://roxira_twenty_crm:3000"
TICKET_MARK = "[rx-ticket:{code}]"


# ----------------------------------------------------------------------------- helpers
def user_ref_for_phone(phone: str) -> str:
    """Same pseudonymous id the payment flow / admin console use (sha256('smartjudge:'+phone)[:16])."""
    return hashlib.sha256(f"smartjudge:{phone}".encode()).hexdigest()[:16]


def norm_phone(raw: str | None) -> str | None:
    """10-digit Iranian national number (9121234567); other numbers are returned as digits only."""
    digits = re.sub(r"\D", "", raw or "")
    if not digits:
        return None
    if digits.startswith("0098"):
        digits = digits[4:]
    elif digits.startswith("98") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    return digits


def _iso(v: Any) -> str | None:
    return v.isoformat() if hasattr(v, "isoformat") else (str(v) if v is not None else None)


# ----------------------------------------------------------------------------- extraction
def _query(conn: Any, errors: list[str], label: str, sql: str) -> list[tuple]:
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
            return list(cur.fetchall())
    except Exception as exc:  # a missing table must not kill the whole sync
        errors.append(f"{label}: {type(exc).__name__}")
        try:
            conn.rollback()
        except Exception:
            pass
        return []


def extract(conn: Any) -> dict:
    """Return {'people': {ref: {...}}, 'orders': [...], 'tickets': [...], 'errors': [...]}."""
    errors: list[str] = []
    people: dict[str, dict] = {}

    def person(ref: str) -> dict:
        return people.setdefault(ref, {"ref": ref, "email": None, "phone": None, "plan": None,
                                       "plan_status": None, "expires_at": None, "created_at": None})

    for ref, email, phone, created in _query(
            conn, errors, "email_accounts",
            "SELECT user_ref, email, contact_phone, created_at FROM email_accounts;"):
        person(ref).update(email=email, phone=norm_phone(phone), created_at=_iso(created))

    phones: set[str] = set()
    for (ph,) in _query(conn, errors, "chat_phones",
                        "SELECT DISTINCT user_phone FROM chat_conversations WHERE user_phone NOT LIKE 'em\\_%';"):
        phones.add(ph)

    cols = {r[0] for r in _query(
        conn, errors, "columns",
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'payment_orders';")}
    method_sql = "method" if "method" in cols else "NULL"
    usdt_sql = "amount_usdt" if "amount_usdt" in cols else "NULL"
    order_rows = _query(
        conn, errors, "payment_orders",
        f"SELECT track_id, plan_type, amount_rial, {method_sql}, {usdt_sql}, user_ref, phone, paid_at, created_at "
        "FROM payment_orders WHERE status = 'paid' ORDER BY id;")
    for row in order_rows:
        if row[6]:
            phones.add(row[6])
    for ph in phones:
        person(user_ref_for_phone(ph))["phone"] = norm_phone(ph)

    by_phone = {p["phone"]: ref for ref, p in people.items() if p["phone"]}
    by_email = {p["email"].lower(): ref for ref, p in people.items() if p["email"]}

    for ref, plan, status, expires in _query(
            conn, errors, "user_entitlements",
            "SELECT user_ref, plan_type, status, expires_at FROM user_entitlements;"):
        target = ref if ref in people else by_phone.get(norm_phone(ref) or "")  # raw-phone keys
        if target:
            people[target].update(plan=plan, plan_status=status, expires_at=_iso(expires))

    orders: list[dict] = []
    for track, plan, rial, method, usdt, uref, phone, paid_at, created in order_rows:
        ref = uref if uref in people else (user_ref_for_phone(phone) if phone else None)
        if ref is None and uref:
            ref = by_phone.get(norm_phone(uref) or "")
        orders.append({"track_id": track, "plan": plan, "amount_rial": int(rial or 0),
                       "method": method or "zibal", "amount_usdt": usdt, "ref": ref,
                       "paid_at": _iso(paid_at or created)})

    tickets: list[dict] = []
    for code, name, contact, dept, subject, message, status, created in _query(
            conn, errors, "support_tickets",
            "SELECT ticket_code, user_name, contact_info, department, subject, message, status, created_at "
            "FROM support_tickets ORDER BY id;"):
        c = (contact or "").strip()
        ref = by_email.get(c.lower()) or by_phone.get(norm_phone(c) or "")
        tickets.append({"code": code, "name": name, "contact": c, "department": dept, "subject": subject,
                        "message": message, "status": status, "ref": ref, "created_at": _iso(created)})
    return {"people": people, "orders": orders, "tickets": tickets, "errors": errors}


# ----------------------------------------------------------------------------- Twenty payloads
def person_payload(p: dict) -> dict:
    label = p["email"] or (f"0{p['phone']}" if p["phone"] else p["ref"])
    body: dict[str, Any] = {
        "externalId": p["ref"],
        "name": {"firstName": "Smart Judge", "lastName": label},
        "plan": p["plan"] or "free",
        "planExpiresAt": p["expires_at"],
    }
    if p["email"]:
        body["emails"] = {"primaryEmail": p["email"]}
    if p["phone"]:
        body["phones"] = {"primaryPhoneNumber": p["phone"], "primaryPhoneCountryCode": "IR",
                          "primaryPhoneCallingCode": "+98"}
    return body


def opportunity_payload(o: dict, person_id: str | None) -> dict:
    if o["method"] == "usdt_trc20" and o["amount_usdt"]:
        micros, cur = int(round(float(o["amount_usdt"]) * 1_000_000)), "USD"
    else:
        micros, cur = o["amount_rial"] * 1_000_000, "IRR"
    body: dict[str, Any] = {
        "externalId": o["track_id"],
        "name": f"{o['plan']} ({o['method']})",
        "amount": {"amountMicros": micros, "currencyCode": cur},
        "stage": "CUSTOMER",
        "closeDate": o["paid_at"],
    }
    if person_id:
        body["pointOfContactId"] = person_id
    return body


def note_payload(t: dict) -> dict:
    title = f"{TICKET_MARK.format(code=t['code'])} {t['subject']}"[:250]
    md = (f"Department: {t['department']}\nStatus: {t['status']}\nFrom: {t['name']} ({t['contact']})\n"
          f"Created: {t['created_at']}\n\n{t['message']}")
    return {"title": title, "bodyV2": {"markdown": md}}


# ----------------------------------------------------------------------------- Twenty client
class TwentyClient(Protocol):
    def list_all(self, obj: str) -> list[dict]: ...
    def create(self, obj: str, body: dict) -> dict: ...
    def update(self, obj: str, rec_id: str, body: dict) -> dict: ...


class HttpTwentyClient:
    """Minimal Twenty REST client (``/rest/<object>``), Bearer API key, cursor pagination."""

    def __init__(self, base_url: str, api_key: str, timeout: int = 30):
        self.base, self.key, self.timeout = base_url.rstrip("/"), api_key, timeout

    def _req(self, method: str, path: str, body: dict | None = None) -> dict:
        req = urllib.request.Request(
            f"{self.base}/rest/{path}", method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Authorization": f"Bearer {self.key}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:  # noqa: S310 internal URL
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"twenty {method} {path}: HTTP {exc.code} {exc.read()[:200]!r}") from None

    def list_all(self, obj: str) -> list[dict]:
        out: list[dict] = []
        cursor = None
        while True:
            data = self._req("GET", f"{obj}?limit=60" + (f"&starting_after={cursor}" if cursor else ""))
            out.extend((data.get("data") or {}).get(obj) or [])
            info = data.get("pageInfo") or {}
            if not info.get("hasNextPage"):
                return out
            cursor = info.get("endCursor")

    def create(self, obj: str, body: dict) -> dict:
        data = self._req("POST", obj, body).get("data") or {}
        rec = next(iter(data.values()), None)  # {"createPerson": {...}}
        return rec if isinstance(rec, dict) else {"id": None}

    def update(self, obj: str, rec_id: str, body: dict) -> dict:
        self._req("PATCH", f"{obj}/{rec_id}", body)
        return {"id": rec_id}


# ----------------------------------------------------------------------------- sync
def _same(want: Any, have: Any) -> bool:
    """True when every field we send already matches (extra fields on the Twenty side are ignored)."""
    if isinstance(want, dict):
        return isinstance(have, dict) and all(_same(v, have.get(k)) for k, v in want.items())
    if want is None:
        return have in (None, "")
    if isinstance(want, str) and isinstance(have, str) and want != have:
        try:
            return (dt.datetime.fromisoformat(want.replace("Z", "+00:00"))
                    == dt.datetime.fromisoformat(have.replace("Z", "+00:00")))
        except ValueError:
            return False
    return want == have


def sync(data: dict, client: TwentyClient | None, apply: bool) -> dict:
    """Upsert people, opportunities and notes. ``client`` may be None only when apply is False."""
    stats = {k: {"create": 0, "update": 0, "same": 0} for k in ("people", "opportunities", "notes")}
    if client is not None:
        have_people = {r["externalId"]: r for r in client.list_all("people") if r.get("externalId")}
        have_opps = {r["externalId"]: r for r in client.list_all("opportunities") if r.get("externalId")}
        have_notes = {(r.get("title") or "").split(" ", 1)[0]: r for r in client.list_all("notes")}
    else:  # dry-run without CRM access: everything counts as "create"
        have_people, have_opps, have_notes = {}, {}, {}
    ids: dict[str, str | None] = {}

    def upsert(kind: str, have: dict, key: str, body: dict) -> str | None:
        cur = have.get(key)
        if cur is None:
            stats[kind]["create"] += 1
            return client.create(kind, body).get("id") if apply and client else None
        if _same(body, cur):
            stats[kind]["same"] += 1
        else:
            stats[kind]["update"] += 1
            if apply and client:
                client.update(kind, cur["id"], body)
        return cur["id"]

    for ref, p in data["people"].items():
        ids[ref] = upsert("people", have_people, ref, person_payload(p))
    for o in data["orders"]:
        pid = ids.get(o["ref"]) if o["ref"] else None
        upsert("opportunities", have_opps, o["track_id"], opportunity_payload(o, pid))
    for t in data["tickets"]:
        if have_notes.get(TICKET_MARK.format(code=t["code"])) is not None:
            stats["notes"]["same"] += 1  # a ticket note is write-once; later admin replies are not re-synced
            continue
        stats["notes"]["create"] += 1
        if apply and client:
            nid = client.create("notes", note_payload(t)).get("id")
            pid = ids.get(t["ref"]) if t["ref"] else None
            if nid and pid:
                client.create("noteTargets", {"noteId": nid, "personId": pid})
    return stats


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--apply", action="store_true", help="write to Twenty (default: dry-run)")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    client: TwentyClient | None = None
    if args.apply:
        key = os.environ.get("TWENTY_API_KEY", "")
        if not key:
            log.error("TWENTY_API_KEY is not set; refusing --apply")
            return 2
        client = HttpTwentyClient(os.environ.get("TWENTY_API_URL") or DEFAULT_URL, key)

    import psycopg
    from src.roxira_config import postgres_dsn  # in the app container PYTHONPATH=/app

    dsn = os.environ.get("DATABASE_URL") or postgres_dsn(
        host=os.environ.get("POSTGRES_HOST", "roxira_postgres_prod"),
        port=int(os.environ.get("POSTGRES_PORT", "5432")))
    with psycopg.connect(dsn, connect_timeout=5) as conn:
        conn.read_only = True
        data = extract(conn)
    try:
        stats = sync(data, client, args.apply)
    except Exception:
        log.exception("crm sync failed")
        return 1
    print(json.dumps({"mode": "apply" if args.apply else "dry-run", "stats": stats,
                      "source_errors": data["errors"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
