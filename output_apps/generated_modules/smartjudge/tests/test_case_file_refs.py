"""B1: page-level case-file references. Fake records only, no network."""

from output_apps.generated_modules.smartjudge import case_files as cf


def _rec(fid, name, pages, text):
    return {"id": fid, "name": name, "pages": pages, "text": text, "status": "ready"}


R1 = _rec("f1", "قرارداد.pdf", 3, "[صفحه 1]\nالف\n\n[صفحه 2]\nب\n\n[صفحه 3]\nج")
R2 = _rec("f2", "چک.pdf", 1, "[صفحه 1]\nچک")


def test_valid_citation_resolved():
    out = cf.extract_case_file_refs("طبق (فایل 1، صفحه 2) تعهد شده است.", [R1, R2])
    assert out == [{"file_id": "f1", "file_name": "قرارداد.pdf", "page": 2}]


def test_persian_digits_and_second_file_and_dedupe():
    ans = "(فایل ۲، صفحه ۱) و (فایل ۱، صفحه ۳) و دوباره (فایل ۲، صفحه ۱)"
    out = cf.extract_case_file_refs(ans, [R1, R2])
    assert [(r["file_id"], r["page"]) for r in out] == [("f1", 3), ("f2", 1)]


def test_invented_page_and_file_dropped():
    ans = "(فایل 1، صفحه 9) (فایل 5، صفحه 1) (فایل 2، صفحه 2) (فایل 1، صفحه 0)"
    assert cf.extract_case_file_refs(ans, [R1, R2]) == []


def test_page_beyond_declared_total_dropped():
    rec = _rec("f", "x", 2, "[صفحه 1]\na\n\n[صفحه 5]\nb")
    assert cf.extract_case_file_refs("(فایل 1، صفحه 5) (فایل 1، صفحه 1)", [rec]) == [
        {"file_id": "f", "file_name": "x", "page": 1}]


def test_truncated_pages_not_in_prompt_are_dropped(monkeypatch):
    monkeypatch.setattr(cf, "PROMPT_TOTAL_CHARS", 2000)
    pages = "\n\n".join(f"[صفحه {i}]\n" + ("متن " * 150) for i in range(1, 11))
    rec = _rec("big", "big.pdf", 10, pages)  # no summary -> head/tail excerpt with a gap
    idx = cf.prompt_page_index([rec])[1]["pages"]
    assert 1 in idx and 10 in idx and 5 not in idx
    out = cf.extract_case_file_refs("(فایل 1، صفحه 5) (فایل 1، صفحه 1)", [rec])
    assert [r["page"] for r in out] == [1]


def test_not_ready_files_do_not_shift_numbering():
    pending = {"id": "p", "name": "p", "status": "processing", "pages": 1, "text": ""}
    out = cf.extract_case_file_refs("(فایل 1، صفحه 1)", [pending, R2])
    assert out == [{"file_id": "f2", "file_name": "چک.pdf", "page": 1}]


def test_no_records_or_no_citation():
    assert cf.extract_case_file_refs("(فایل 1، صفحه 1)", []) == []
    assert cf.extract_case_file_refs("بدون ارجاع", [R1]) == []


def test_prompt_asks_for_citation_format():
    sys_add, block = cf.build_prompt_parts([R1])
    assert "(فایل X، صفحه N)" in sys_add and "[صفحه 2]" in block


import pytest


@pytest.mark.parametrize("cite", [
    "(فایل ۲، صفحه ۳)", "(فایل 1، صفحه 3)", "(فایل ۱ ، صفحه ۳)", "(فایل 1,صفحه 3)",
    "(سند 1، ص 3)", "(سند ۱، ص۳)", "(فایل ۱، ص. ۳)", "(فایل 1: صفحه 3)",
])
def test_cite_variants(cite):
    rec1 = _rec("a", "a", 3, "[صفحه 1]\nx\n\n[صفحه 2]\ny\n\n[صفحه 3]\nz")
    recs = [rec1, _rec("b", "b", 3, "[صفحه 1]\nx\n\n[صفحه 2]\ny\n\n[صفحه 3]\nz")]
    out = cf.extract_case_file_refs("متن " + cite + " پایان", recs)
    doc = "b" if "۲" in cite.split("،")[0] else "a"
    assert out == [{"file_id": doc, "file_name": doc, "page": 3}]
