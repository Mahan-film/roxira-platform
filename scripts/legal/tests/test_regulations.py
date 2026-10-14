"""Offline tests for scripts/legal/ingest_regulations.py (deregulation-board resolutions + CBI circulars).

No network, no LLM, no Qdrant. Run ONLY this file:
  python3 -m pytest scripts/legal/tests/test_regulations.py -q
"""
import importlib.util
import json
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


regr = _load("ingest_regulations", "scripts/legal/ingest_regulations.py")

BOARD = {
    "doc_id": "deregulation_board_session_92",
    "doc_type": "board_resolution",
    "issuer": "هیئت مقررات‌زدایی و بهبود محیط کسب و کار",
    "session": 92,
    "session_title": "مصوبات نود و دومین نشست هیئت مقررات‌زدایی",
    "approved_on": "1404-09-10",
    "meeting_date": "1404-09-10",
    "heading_letter": "الف",
    "subject": "حذف الزام مجوز",
    "item_no": "1",
    "item_label": "بند الف - 1",
    "chunk_index": 0,
    "text": "متن بند اول که به اندازه کافی بلند است تا در یک ردیف باشد.",
    "source": "qavanin",
    "source_tier": "official",
    "needs_review": True,
    "review_reasons": [],
    "status": "proposed",
}
CIRC = {
    "doc_id": "cbi_05_101819",
    "doc_type": "circular",
    "issuer": "بانک مرکزی جمهوری اسلامی ایران",
    "number": "05/101819",
    "date": "1405-05-04",
    "subject": "دستورالعمل نمونه",
    "chunk_index": 0,
    "chunk_count": 1,
    "text": "احتراما متن اصلی بخشنامه بانک مرکزی.",
    "source_file": "x.pdf",
    "source": "owner_upload_cbi_circular",
    "needs_review": True,
    "status": "proposed",
}


# ----------------------------------------------------------------------------- conversion
def test_board_row_conversion():
    row = regr.to_ingest_row(BOARD)
    assert row["law_name"] == regr.LAW_BOARD and row["law_type"] == "REGULATION"
    assert row["article_no"] == "0" and row["article_label"] == "deregulation_board_session_92"
    assert row["title"] == f"هیئت مقررات‌زدایی و بهبود محیط کسب و کار {DASH} حذف الزام مجوز"
    assert row["ref"] == "جلسه 92 بند 1"
    assert row["full_text"] == BOARD["text"] and len(row["text"]) <= regr.EMBED_CHARS
    assert "حذف الزام مجوز" in row["text"]
    assert row["needs_review"] is True and row["review_reasons"] == []
    assert row["is_active"] is True and row["source_tier"] == "official"
    assert row["approval_date"] == "1404-09-10"


def test_circular_row_conversion_upgrades_missing_tier():
    row = regr.to_ingest_row(CIRC)
    assert row["law_name"] == regr.LAW_CIRCULAR
    assert row["ref"] == "05/101819"
    assert row["title"] == f"بانک مرکزی جمهوری اسلامی ایران {DASH} دستورالعمل نمونه"
    assert row["source_tier"] == "unofficial" and row["is_active"] is True
    assert row["approval_date"] == "1405-05-04"
    assert row["full_text"] == CIRC["text"]


def test_ref_without_item_number_is_session_only():
    assert regr.regulation_ref({**BOARD, "item_no": None}) == "جلسه 92"
    assert regr.regulation_ref({"doc_type": "circular"}) == ""


def test_embed_text_is_clipped():
    row = regr.to_ingest_row({**BOARD, "text": "کلمه " * 5000})
    assert len(row["text"]) == regr.EMBED_CHARS


def test_internal_keys_are_dropped_but_source_fields_stay():
    row = regr.to_ingest_row({**BOARD, "_private": 1, "ingest_pipeline": "x"})
    assert "_private" not in row and "ingest_pipeline" not in row
    assert row["item_label"] == "بند الف - 1" and row["session"] == 92


# ----------------------------------------------------------------------------- gates + point ids
def test_rows_pass_pipeline_gates():
    ip = regr._ip()
    rows = [regr.to_ingest_row(BOARD), regr.to_ingest_row(CIRC)]
    rep = ip.validate_rows(rows, regr.allowlist())
    assert rep["ok"], rep["gate_counts"]
    assert ip.point_id(rows[0]) != ip.point_id(rows[1])


def test_point_ids_are_deterministic_and_keyed_on_doc_and_chunk():
    ip = regr._ip()
    a = regr.to_ingest_row(BOARD)
    assert ip.point_id(a) == ip.point_id(regr.to_ingest_row(BOARD))  # rerun is idempotent
    other_chunk = regr.to_ingest_row({**BOARD, "chunk_index": 1})
    other_doc = regr.to_ingest_row({**BOARD, "doc_id": "deregulation_board_session_93"})
    assert len({ip.point_id(a), ip.point_id(other_chunk), ip.point_id(other_doc)}) == 3


# ----------------------------------------------------------------------------- loading + CLI
def test_load_ingest_rows(tmp_path):
    p = tmp_path / "regs.jsonl"
    p.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in (BOARD, CIRC)), encoding="utf-8")
    rows = regr.load_ingest_rows([p])
    assert [r["doc_type"] for r in rows] == ["board_resolution", "circular"]


def test_cli_validate_ok(tmp_path, capsys):
    p = tmp_path / "regs.jsonl"
    p.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in (BOARD, CIRC)), encoding="utf-8")
    assert regr.main(["validate", str(p)]) == 0
    assert json.loads(capsys.readouterr().out)["ok"] is True


def test_cli_apply_dry_run_writes_nothing(tmp_path):
    p = tmp_path / "regs.jsonl"
    p.write_text(json.dumps(BOARD, ensure_ascii=False), encoding="utf-8")
    calls = []

    def http(method, url, body=None):
        calls.append((method, url))
        return 200, {}

    def embed(texts):
        return [[0.0] * 4 for _ in texts]

    rc = regr.main(["apply", str(p), "--collection", "iran_regulations_v1", "--dry-run"], http=http, embed=embed)
    assert rc == 0 and calls == []


def test_cli_apply_refuses_a_non_local_qdrant(tmp_path):
    p = tmp_path / "regs.jsonl"
    p.write_text(json.dumps(BOARD, ensure_ascii=False), encoding="utf-8")
    rc = regr.main(
        ["apply", str(p), "--collection", "iran_regulations_v1", "--qdrant", "http://evil.example:6333"],
        http=lambda *a, **k: (200, {}),
        embed=lambda texts: [[0.0] * 4 for _ in texts],
    )
    assert rc == 2
