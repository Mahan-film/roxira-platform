"""History restore: only still-existing, owned case files are re-attached. Fakes only."""

from output_apps.generated_modules.smartjudge import smartjudge_module as mod

A = "11111111-1111-4111-8111-111111111111"
B = "22222222-2222-4222-8222-222222222222"


def _fake_status(views):
    def get_status(fid, phone):
        return views.get((fid, phone))
    return get_status


def test_latest_user_turn_files_that_still_exist(monkeypatch):
    views = {
        (A, "0912"): {"id": A, "status": "ready", "name": "a.pdf", "pages": 3},
        (B, "0912"): {"id": B, "status": "failed", "name": "b.pdf", "pages": 0},
    }
    monkeypatch.setattr(mod._case_files, "get_status", _fake_status(views))
    msgs = [
        {"role": "user", "text": "x", "case_file_ids": [B]},
        {"role": "assistant", "text": "y", "case_file_ids": []},
        {"role": "user", "text": "z", "case_file_ids": [A, B, "gone"]},
        {"role": "assistant", "text": "w", "case_file_ids": []},
    ]
    assert mod._restorable_case_files(msgs, "0912") == [{"id": A, "name": "a.pdf", "pages": 3}]


def test_other_owner_or_no_files_gives_nothing(monkeypatch):
    monkeypatch.setattr(mod._case_files, "get_status", _fake_status({}))
    assert mod._restorable_case_files([{"role": "user", "text": "x", "case_file_ids": [A]}], "0999") == []
    assert mod._restorable_case_files([{"role": "user", "text": "x", "case_file_ids": []}], "0912") == []
    assert mod._restorable_case_files([], "0912") == []


def test_capped_at_five(monkeypatch):
    ids = [f"{i}1111111-1111-4111-8111-111111111111" for i in range(8)]
    views = {(i, "p"): {"id": i, "status": "ready", "name": "f", "pages": 1} for i in ids}
    monkeypatch.setattr(mod._case_files, "get_status", _fake_status(views))
    out = mod._restorable_case_files([{"role": "user", "text": "x", "case_file_ids": ids}], "p")
    assert len(out) == 5


# ---- through the real GET /conversations/{id}/messages DB branch (store faked) ----
import json
from contextlib import contextmanager

from fastapi import FastAPI
from fastapi.testclient import TestClient

from output_apps.generated_modules.smartjudge import chat_auth

CONV = "33333333-3333-4333-8333-333333333333"


class _Cur:
    def __init__(self, rows):
        self.rows = rows

    def execute(self, *a, **k):
        pass

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _Conn(_Cur):
    def cursor(self):
        return _Cur(self.rows)


def _client(monkeypatch, rows, views):
    monkeypatch.setattr(mod.psycopg, "connect", lambda *a, **k: _Conn(rows))
    monkeypatch.setattr(mod, "_conversation_owned_by", lambda cid, phone: True)
    monkeypatch.setattr(mod._case_files, "get_status", _fake_status(views))
    app = FastAPI()
    app.include_router(mod.router)

    async def current():
        return chat_auth.CurrentUser(phone="0912", tier="FREE", authenticated=True)

    app.dependency_overrides[mod.get_current_user] = current
    return TestClient(app)


def test_db_branch_restores_files_saved_by_chat(monkeypatch):
    # Rows exactly as /chat writes them: user metadata {"case_file_ids": [...]}, assistant metadata
    # {probability, draft, laws, precedents}; one row comes back as a JSON string, one as a dict.
    rows = [
        ("user", "سلام", json.dumps({"case_file_ids": [A]}), None),
        ("assistant", "پاسخ", {"probability": None, "draft": "متن لایحه", "laws": [{"x": 1}], "precedents": []}, None),
        ("user", "ادامه", {}, None),
        ("assistant", "پاسخ دوم", {"probability": "70%", "draft": None, "laws": [], "precedents": []}, None),
    ]
    views = {(A, "0912"): {"id": A, "status": "ready", "name": "a.pdf", "pages": 3}}
    r = _client(monkeypatch, rows, views).get(f"/api/v1/apps/judge/conversations/{CONV}/messages")
    assert r.status_code == 200, r.text
    body = r.json()
    # the latest user turn that carried files defines the context (a follow-up without files keeps it)
    assert body["case_files"] == [{"id": A, "name": "a.pdf", "pages": 3}]
    assert body["messages"][1]["draft"] == "متن لایحه"
    # an expired / foreign file is dropped instead of breaking the next /chat call
    gone = _client(monkeypatch, rows, {}).get(f"/api/v1/apps/judge/conversations/{CONV}/messages").json()
    assert gone["case_files"] == []


def test_db_branch_keeps_assistant_draft_and_probability(monkeypatch):
    rows = [
        ("user", "q", {}, None),
        ("assistant", "a", {"probability": "55%", "draft": "لایحه", "laws": [], "precedents": []}, None),
    ]
    body = _client(monkeypatch, rows, {}).get(f"/api/v1/apps/judge/conversations/{CONV}/messages").json()
    user_m, asst = body["messages"]
    assert set(asst) == {"role", "text", "probability", "draft", "laws", "precedents", "case_file_ids"}
    assert asst["draft"] == "لایحه" and asst["probability"] == "55%" and asst["case_file_ids"] == []
    assert user_m["case_file_ids"] == [] and set(user_m) == set(asst)
