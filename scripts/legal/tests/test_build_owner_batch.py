"""Offline tests for scripts/legal/build_owner_batch.py (inline fixtures)."""
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("build_owner_batch", ROOT / "scripts" / "legal" / "build_owner_batch.py")
bob = importlib.util.module_from_spec(spec)
sys.modules["build_owner_batch"] = bob
spec.loader.exec_module(bob)

DEREG = """garbled
https://qavanin.ir/Law/PrintText/?IDS=77&font=
10/13/26, 3:51 AM
مصوبات نود و دومین نشست هیئت مقررات زدایي - مصوب 1404/09/10
مصوب 1404,09,10
الف - حذف الزام مجوز
. 1 متن بند اول که طولانی است و باید در یک ردیف بماند و به اندازه کافی بلند باشد تا فرعی نباشد.
. 2 دبیرخانه مکلف است اقدام کند.
ب – اعلام نافذ نبودن
پیرو بند ب مصوبه نودم هیئت متن کامل بدون بند شماره دار.
"""


def test_deregulation_rows():
    rows, rpt = bob.parse_deregulation(DEREG, "f.pdf")
    assert rpt["session"] == 92 and rpt["approved_on"] == "1404-09-10"
    assert [(r["heading_letter"], r["item_no"]) for r in rows] == [("الف", "1"), ("الف", "2"), ("ب", None)]
    assert all(r["status"] == "proposed" and r["session"] == 92 for r in rows)
    assert rows[0]["subject"] == "حذف الزام مجوز"


def test_header_meta_and_body():
    meta = bob.header_meta("05/101819\n1405/05/04\nدارد\n8763163\n")
    assert meta == {"number": "05/101819", "date": "1405-05-04"}
    body = bob.circular_body("letterhead junk\nبا سلام؛\nاحتراما متن اصلی بخشنامه.\nاداره مطالعات و مقررات\n123\n")
    assert body == "احتراما متن اصلی بخشنامه."


def test_chunking_keeps_article_boundaries():
    text = "\n".join([f"ماده {i}- " + "کلمه " * 60 for i in range(1, 12)])
    chunks = bob.chunk_text(text, size=1000)
    assert all(len(c) <= 1000 for c in chunks)
    assert all(c.startswith("ماده") for c in chunks)
    long = bob.chunk_text("جمله. " * 800, size=1500)
    assert all(len(c) <= 1500 for c in long) and len(long) > 2


def test_circular_rows_schema():
    rows, rpt = bob.circular_rows("با سلام؛\nاحتراما پیرو ابلاغ «دستورالعمل نمونه» مقتضی است.\n", "05/12345\n1405/01/02\n", "x.pdf")
    assert rows[0]["doc_id"] == "cbi_05_12345" and rows[0]["status"] == "proposed"
    assert rows[0]["subject"] == "دستورالعمل نمونه" and rows[0]["chunk_count"] == 1
    assert rpt["number"] == "05/12345"
