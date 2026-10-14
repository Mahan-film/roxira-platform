"""Offline tests for the Iran-relay row schema mapping in scripts/legal/ingest_regulations.py.

No network, no LLM, no Qdrant. Run ONLY this file:
  python3 -m pytest scripts/legal/tests/test_regulations_relay.py -q
"""
import importlib.util
import json
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
DASH = "\u2014"


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


regr = _load("ingest_regulations_relay", "scripts/legal/ingest_regulations.py")

LONG_TEXT = ("در راستای تسهیل امور مؤدیان و اجرای مقررات مربوط، متن این بخشنامه برای بررسی و اقدام لازم به "
             "واحدهای ذی‌ربط ابلاغ می‌گردد تا مفاد آن به‌طور دقیق اجرا شود. ") * 3

RELAY_CIRCULAR = {
    "source": "taxreg",
    "source_tier": "official",
    "url": "https://regulation.tax.gov.ir/lwvi?lid=txs5000151727&ty=nz",
    "doc_id": "taxreg:txs5000151727",
    "title": "بخشنامه 200/1405/45",
    "doc_type": "circular",
    "number": "200/1405/45",
    "date": "1405/06/15",
    "issuer": "رئیس کل سازمان امور مالیاتی کشور",
    "text": LONG_TEXT,
    "fetched_at": "2026-10-14T20:04:47Z",
    "staging_status": "proposed",
    "needs_review": True,
}

RELAY_OTHER = {**RELAY_CIRCULAR, "doc_id": "taxreg:txs999", "doc_type": "other",
               "title": "نظرات حقوقی 7/1403/667", "number": "7/1403/667"}

CBI = {
    "doc_id": "cbi_05_101819",
    "doc_type": "circular",
    "issuer": "بانک مرکزی جمهوری اسلامی ایران",
    "number": "05/101819",
    "date": "1405-05-04",
    "subject": "دستورالعمل نمونه",
    "chunk_index": 0,
    "chunk_count": 1,
    "text": "احتراما متن اصلی بخشنامه بانک مرکزی است و به اندازه کافی طولانی است.",
    "source_file": "x.pdf",
    "source": "owner_upload_cbi_circular",
    "needs_review": True,
    "status": "proposed",
}


def test_is_relay_row_detects_relay_sources_only():
    assert regr.is_relay_row(RELAY_CIRCULAR) and regr.is_relay_row(RELAY_OTHER)
    assert not regr.is_relay_row(CBI)


def test_relay_circular_maps_to_circular_law():
    row = regr.to_ingest_row(RELAY_CIRCULAR)
    assert row["law_name"] == regr.RELAY_LAWS["taxreg"] and row["law_type"] == "REGULATION"
    assert row["doc_type"] == "circular" and row["doc_id"] == "taxreg:txs5000151727"
    assert row["title"] == "بخشنامه 200/1405/45"
    assert row["ref"] == "200/1405/45" and row["number"] == "200/1405/45"
    assert row["article_label"] == "taxreg:txs5000151727" and row["article_no"] == "0"
    assert row["full_text"] == LONG_TEXT and "بخشنامه 200/1405/45" in row["text"]
    assert row["source_tier"] == "official" and row["is_active"] is True
    assert row["approval_date"] == "1405/06/15" and row["status"] == "proposed"
    assert row["needs_review"] is True
    assert row["source_url"] == RELAY_CIRCULAR["url"]


def test_relay_non_circular_maps_to_board_law_and_keeps_needs_review():
    row = regr.to_ingest_row(RELAY_OTHER)
    assert row["law_name"] == regr.RELAY_LAWS["taxreg"]
    assert row["title"] == "نظرات حقوقی 7/1403/667" and row["ref"] == "7/1403/667"
    assert row["needs_review"] is True and row["source_url"] == RELAY_OTHER["url"]


def test_relay_staging_status_becomes_the_gate_status():
    row = regr.to_ingest_row({**RELAY_CIRCULAR, "staging_status": "proposed"})
    assert row["status"] == "proposed"


def test_relay_short_text_is_skipped_and_logged(tmp_path, caplog):
    short = {**RELAY_CIRCULAR, "doc_id": "dotic:1", "source": "dotic", "text": "تیتر کوتاه"}
    p = tmp_path / "relay.jsonl"
    p.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in (RELAY_CIRCULAR, short)), encoding="utf-8")
    with caplog.at_level(logging.WARNING, logger="ingest_regulations"):
        rows = regr.load_ingest_rows([p])
    assert [r["article_label"] for r in rows] == ["taxreg:txs5000151727"]
    assert "skip" in caplog.text and "dotic:1" in caplog.text


def test_relay_at_minimum_length_is_kept(tmp_path):
    edge = {**RELAY_CIRCULAR, "text": "ا" * regr.MIN_RELAY_TEXT_CHARS}
    p = tmp_path / "relay.jsonl"
    p.write_text(json.dumps(edge, ensure_ascii=False), encoding="utf-8")
    assert len(regr.load_ingest_rows([p])) == 1


def test_old_cbi_schema_is_unchanged():
    row = regr.to_ingest_row(CBI)
    assert row["law_name"] == regr.LAW_CIRCULAR
    assert row["title"] == f"بانک مرکزی جمهوری اسلامی ایران {DASH} دستورالعمل نمونه"
    assert row["ref"] == "05/101819" and row["approval_date"] == "1405-05-04"
    assert row["source_tier"] == "unofficial" and row["status"] == "proposed"
    assert row["full_text"] == CBI["text"] and row["article_no"] == "0"
    assert "source_url" not in row and row["needs_review"] is True


def test_old_cbi_short_text_is_not_skipped(tmp_path):
    p = tmp_path / "cbi.jsonl"
    p.write_text(json.dumps({**CBI, "text": "کوتاه"}, ensure_ascii=False), encoding="utf-8")
    assert len(regr.load_ingest_rows([p])) == 1


def test_relay_rows_pass_the_pipeline_gates():
    ip = regr._ip()
    rows = [regr.to_ingest_row(RELAY_CIRCULAR), regr.to_ingest_row(RELAY_OTHER)]
    rep = ip.validate_rows(rows, regr.allowlist())
    assert rep["ok"], rep["gate_counts"]
    assert ip.point_id(rows[0]) != ip.point_id(rows[1])


def test_relay_rows_get_their_own_law_name():
    row = {"source": "taxreg", "doc_id": "taxreg:x", "title": "t", "doc_type": "other", "text": "x" * 300}
    out = regr.to_ingest_row(row)
    assert out["law_name"] == regr.RELAY_LAWS["taxreg"]
    assert out["law_name"] != regr.LAW_BOARD
