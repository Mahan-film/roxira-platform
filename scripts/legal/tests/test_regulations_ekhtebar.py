"""Offline tests for the ekhtebar.ir row mapping + dedupe in scripts/legal/ingest_regulations.py.

No network, no LLM, no Qdrant. Run ONLY this file:
  python3 -m pytest scripts/legal/tests/test_regulations_ekhtebar.py -q
"""
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


regr = _load("ingest_regulations_ekhtebar", "scripts/legal/ingest_regulations.py")

# One row as scripts/legal/ekhtebar_api.py writes it (sync_sources schema + ekhtebar additions).
EKHTEBAR = {
    "law_id": "sync_ekhtebar_501",
    "law_name": "بخشنامه شماره ۱۲۳ بانک مرکزی",
    "law_type": "LAW",
    "article_no": "1",
    "article_label": "ماده 1",
    "chapter": None,
    "amended_on": None,
    "approval_date": "1405-05-04",
    "status": "VALID",
    "is_active": True,
    "source_url": "https://www.ekhtebar.com/?p=501",
    "source": "ekhtebar",
    "source_label": "ekhtebar.ir",
    "source_tier": "unofficial",
    "content_hash": "deadbeef",
    "chunk_index": 0,
    "text": "احتراما متن اصلی بخشنامه بانک مرکزی است و برای اجرا ابلاغ می‌گردد.",
    "title": "بخشنامه شماره ۱۲۳ بانک مرکزی - ماده 1",
    "category": "SYNC_REGULATION",
    "scope_tags": ["regulation"],
    "needs_review": True,
    "review_reasons": ["unofficial_source", "lawyer_review_pending"],
    "instrument_kind": "regulation",
    "authority": "بانک مرکزی جمهوری اسلامی ایران",
    "document_number": "123/1405",
    "page_status": "valid",
    "staging_status": "proposed",
    "retrieved_at": "2026-10-22T00:00:00+00:00",
    "modified": "2026-10-20T00:00:00+00:00",
    "ekhtebar_post_id": 501,
}

CBI = {
    "doc_id": "cbi_05_101819",
    "doc_type": "circular",
    "issuer": "بانک مرکزی جمهوری اسلامی ایران",
    "number": "05/101819",
    "date": "1405-05-04",
    "subject": "دستورالعمل نمونه",
    "chunk_index": 0,
    "text": "احتراما متن اصلی بخشنامه بانک مرکزی.",
    "source": "owner_upload_cbi_circular",
    "status": "proposed",
}


# ----------------------------------------------------------------------------- detection
def test_is_ekhtebar_row_by_source_or_label():
    assert regr.is_ekhtebar_row(EKHTEBAR)
    assert regr.is_ekhtebar_row({"source_label": "ekhtebar.ir"})
    assert not regr.is_ekhtebar_row(CBI)


def test_old_cbi_row_is_not_remapped():
    row = regr.to_ingest_row(CBI)
    assert row["law_name"] == regr.LAW_CIRCULAR
    assert row["ref"] == "05/101819" and row["source_tier"] == "unofficial"


# ----------------------------------------------------------------------------- mapper
def test_ekhtebar_mapper_keeps_post_title_and_article():
    row = regr.to_ingest_row(EKHTEBAR)
    assert row["law_name"] == EKHTEBAR["law_name"] and row["law_type"] == "REGULATION"
    assert row["article_no"] == "1" and row["article_label"] == "ماده 1"
    assert row["ref"] == "123/1405"
    assert row["title"] == EKHTEBAR["title"]
    assert row["source_tier"] == "unofficial" and row["status"] == "VALID"
    assert row["is_active"] is True and row["needs_review"] is True
    assert row["full_text"] == EKHTEBAR["text"]
    assert row["source_url"] == EKHTEBAR["source_url"]


def test_ekhtebar_mapper_falls_back_to_law_id_and_default_status():
    row = {k: v for k, v in EKHTEBAR.items() if k not in ("article_label", "status")}
    mapped = regr.to_ingest_row(row)
    assert mapped["article_label"] == "sync_ekhtebar_501"
    assert mapped["status"] == "proposed"


def test_ekhtebar_mapper_honours_a_repealed_row():
    row = regr.to_ingest_row({**EKHTEBAR, "status": "REPEALED", "is_active": False})
    assert row["is_active"] is False
    ip = regr._ip()
    rep = ip.validate_rows([row], regr.allowlist([row]))
    assert not rep["ok"] and rep["gate_counts"]["repealed"] == 1


def test_ekhtebar_row_passes_the_pipeline_gates_with_a_dynamic_allowlist():
    ip = regr._ip()
    rows = [regr.to_ingest_row(EKHTEBAR)]
    assert ip.norm_name(EKHTEBAR["law_name"]) not in regr.allowlist()  # name only allowed per run
    rep = ip.validate_rows(rows, regr.allowlist(rows))
    assert rep["ok"], rep["gate_counts"]


# ----------------------------------------------------------------------------- dedupe keys
def test_dedupe_key_matches_issuer_number_date_across_schemas():
    a = {"issuer": "بانک مرکزی", "number": "123", "date": "1405-05-04"}
    b = {"authority": "بانک مرکزی", "document_number": "123", "approval_date": "1405-05-04"}
    assert regr.dedupe_key(a) == regr.dedupe_key(b)


def test_dedupe_key_groups_the_chunks_of_one_document():
    a = {"issuer": "بانک مرکزی", "number": "123", "date": "1405-05-04", "article_label": "ماده 1"}
    b = {**a, "article_label": "ماده 2"}
    assert regr.dedupe_key(a) == regr.dedupe_key(b)


def test_dedupe_key_separates_different_documents():
    a = {"issuer": "بانک مرکزی", "number": "123", "date": "1405-05-04"}
    b = {"issuer": "بانک مرکزی", "number": "456", "date": "1405-05-04"}
    assert regr.dedupe_key(a) != regr.dedupe_key(b)


def test_dedupe_key_falls_back_to_normalised_title():
    a = {"law_name": "بخشنامه الف"}
    b = {"law_name": "بخشنامه\u200cالف"}  # ZWNJ
    assert regr.dedupe_key(a) == regr.dedupe_key(b)


# ----------------------------------------------------------------------------- scan / dry run
def test_scan_files_reports_accepted_duplicate_rejected(tmp_path):
    f1 = tmp_path / "v2.jsonl"
    f2 = tmp_path / "new.jsonl"
    a1 = {**EKHTEBAR, "article_no": "1", "article_label": "ماده 1"}
    a2 = {**EKHTEBAR, "article_no": "2", "article_label": "ماده 2"}
    f1.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in (a1, a2)) + "\n", encoding="utf-8"
    )
    # f2 repeats document A (same issuer+number+date) and adds the new document B.
    a3 = {**EKHTEBAR, "article_no": "3", "article_label": "ماده 3", "text": "متن مکمل"}
    b1 = {**EKHTEBAR, "document_number": "999/1405", "text": "سند دیگر",
          "source_url": "https://www.ekhtebar.com/?p=999"}
    f2.write_text(
        json.dumps(a3, ensure_ascii=False) + "\n"
        + "{not json\n"
        + json.dumps(b1, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    rows, report = regr.scan_files([f1, f2])
    assert report[0] == {"file": str(f1), "accepted": 2, "duplicate": 0, "rejected": 0}
    assert report[1] == {"file": str(f2), "accepted": 1, "duplicate": 1, "rejected": 1}
    assert [r["article_label"] for r in rows] == ["ماده 1", "ماده 2", "ماده 1"]


def test_scan_files_keeps_short_ekhtebar_text(tmp_path):
    p = tmp_path / "ekhtebar.jsonl"
    p.write_text(json.dumps({**EKHTEBAR, "text": "کوتاه"}, ensure_ascii=False), encoding="utf-8")
    rows, report = regr.scan_files([p])
    assert report[0]["accepted"] == 1 and len(rows) == 1


def test_cli_apply_dry_run_prints_per_file_counts(tmp_path, capsys):
    p = tmp_path / "ekhtebar.jsonl"
    p.write_text(json.dumps(EKHTEBAR, ensure_ascii=False), encoding="utf-8")
    rc = regr.main(
        ["apply", str(p), "--collection", "iran_regulations_v3", "--dry-run"],
        http=lambda *a, **k: (200, {}),
        embed=lambda texts: [[0.0] * 4 for _ in texts],
    )
    assert rc == 0
    out = json.loads(capsys.readouterr().out)
    assert out["dry_run"] is True and out["files"][0]["accepted"] == 1
