"""Latest-regulation answers must not present unreviewed/OCR rows as official, and untrusted
dates must not win 'latest' (HUB re-review blocker on #1385). Offline: light modules only."""

import asyncio
import datetime as dt

from output_apps.generated_modules.smartjudge import catalog_intent as ci
from output_apps.generated_modules.smartjudge import rulings_retrieval as rr

TODAY_ISO = "2026-11-25"  # Jalali 1405


def _today():
    return dt.date.fromisoformat(TODAY_ISO)


def _row(**kw):
    base = {"number": "1", "title": "بخشنامه", "issuer": "بانک مرکزی", "subject": "وام"}
    base.update(kw)
    return base


def test_reversed_ocr_date_never_wins_latest():
    good = _row(number="10", date="1404-02-08", source_tier="official", needs_review=False)
    reversed_ocr = _row(number="99", date="08/02/1405", source_tier="unofficial", needs_review=True)
    future = _row(number="98", date="1409-01-01", source_tier="unofficial", needs_review=True)
    out = rr.parse_and_sort([reversed_ocr, future, good], today=_today())
    assert out[0]["number"] == "10"
    assert rr.validated_date(reversed_ocr, _today()) is None
    assert rr.validated_date(future, _today()) is None
    assert rr.validated_date(_row(date="2027-01-01"), _today()) is None
    assert rr.validated_date(_row(date="1405/2/8"), _today()) == (1405, 2, 8)
    assert rr.validated_date(_row(date="1405-02-08"), _today()) == (1405, 2, 8)
    assert rr.validated_date(_row(date="1405-09-05"), _today()) is None  # tomorrow in Jalali


def test_gregorian_dates_are_converted_exactly():
    assert rr.gregorian_to_jalali(2026, 11, 25) == (1405, 9, 4)
    assert rr.gregorian_to_jalali(2025, 3, 21) == (1404, 1, 1)
    assert rr.gregorian_to_jalali(2024, 3, 20) == (1403, 1, 1)
    assert rr.is_jalali_leap(1403) and not rr.is_jalali_leap(1404)
    assert rr.validated_date(_row(date="1403-12-30"), _today()) == (1403, 12, 30)
    assert rr.validated_date(_row(date="1404-12-30"), _today()) is None
    assert rr.validated_date(_row(date="1404-07-31"), _today()) is None
    assert rr.validated_date(_row(date="2026-11-25"), _today()) == (1405, 9, 4)
    greg = _row(number="1", date="2026-06-01", source_tier="official")  # Jalali 1405-03-11
    jal = _row(number="2", date="1405-05-01", source_tier="official")
    assert rr.parse_and_sort([greg, jal], today=_today())[0] is jal


def test_existing_order_kept_for_valid_dates():
    items = [
        {"approval_date": "1402-10-15", "number": "50"},
        {"approval_date": "1403-05-04", "number": "10"},
        {"approval_date": "1403-05-04", "number": "20"},
        {"approval_date": "1401-01-01", "number": "999"},
    ]
    numbers = [r["number"] for r in rr.parse_and_sort(items, today=_today())]
    assert numbers == ["20", "10", "50", "999"]


def test_official_copy_preferred_on_same_date_and_inactive_dropped():
    official = _row(number="7", date="1405-03-01", source_tier="official", needs_review=False)
    ocr = _row(number="7", date="1405-03-01", source_tier="unofficial", needs_review=True)
    assert rr.parse_and_sort([ocr, official], today=_today())[0] is official
    assert rr.is_inactive({"status": "repealed"}) and rr.is_inactive({"is_active": False})
    assert not rr.is_inactive({"status": "proposed"}) and not rr.is_inactive({"status": "VALID"})


def test_unreviewed_row_never_called_official():
    ocr = _row(number="5", date="1405-03-01", source_tier="unofficial", needs_review=True)
    for voice in (True, False):
        ans = ci.format_deterministic_answer([ocr], target="regulation", is_voice=voice)
        assert "رسمی سامانه" not in ans and "قطعی" not in ans
        assert ci.UNOFFICIAL_FA in ans
    ctx = ci.build_catalog_context([ocr], target="regulation")
    assert "قطعی و معتبر" not in ctx and ci.UNOFFICIAL_FA in ctx


def test_official_reviewed_row_keeps_official_wording():
    off = _row(number="5", date="1405-03-01", source_tier="official", needs_review=False)
    ans = ci.format_deterministic_answer([off], target="regulation", is_voice=False)
    assert "منابع رسمی" in ans and ci.UNOFFICIAL_FA not in ans


def test_latest_rulings_regulations_dedupes_and_filters(monkeypatch, tmp_path):
    payloads = [
        {"number": "7", "date": "1405-03-01", "source_tier": "unofficial", "needs_review": True,
         "status": "proposed"},
        {"number": "7", "date": "1405-03-01", "source_tier": "official", "needs_review": False,
         "status": "VALID"},
        {"number": "8", "date": "1405-04-01", "status": "repealed", "source_tier": "official"},
    ]
    import output_apps.generated_modules.smartjudge.legal_graph.lightrag_engine as eng

    class _Resp:
        status_code = 200

        def json(self):
            return {"result": {"points": [{"payload": p} for p in payloads]}}

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            return _Resp()

    class _Q:
        @staticmethod
        def skip_cloud_response(*a):
            return False

        @staticmethod
        def record(*a, **k):
            return None

    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    monkeypatch.setattr(eng, "_qdrant_targets", lambda: [("local", "http://q", {})], raising=False)
    monkeypatch.setattr(eng, "_qcloud", _Q, raising=False)
    rr._LATEST_CACHE.clear()
    rows = asyncio.run(rr.latest_rulings(limit=5, sub_collection="regulations", coll_name="t_regs"))
    assert [r["number"] for r in rows] == ["7"]
    assert rows[0]["source_tier"] == "official"
