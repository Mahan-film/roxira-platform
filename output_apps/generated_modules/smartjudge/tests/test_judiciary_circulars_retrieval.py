"""Offline tests for #1382: judiciary_circulars retrieval, mapping, flag-off default, and deduplication."""

import asyncio


def test_flag_default_off(monkeypatch):
    from output_apps.generated_modules.smartjudge import judiciary_circulars_retrieval as jc

    monkeypatch.delenv("JUDICIARY_CIRCULARS_COLLECTION", raising=False)
    assert jc.collection() == ""
    assert jc.enabled() is False

    called = False

    def _embed(_q):
        nonlocal called
        called = True
        return [0.1] * 1024

    rows = asyncio.run(jc.retrieve_judiciary_circulars("بخشنامه جدید قوه قضائیه", embed=_embed))
    assert rows == []
    assert called is False


def test_payload_to_row_maps_common_citation_fields(monkeypatch):
    from output_apps.generated_modules.smartjudge import judiciary_circulars_retrieval as jc

    monkeypatch.setenv("JUDICIARY_CIRCULARS_COLLECTION", "judiciary_circulars")
    row = jc.payload_to_row(
        {
            "circular_no": "9000/12345/100",
            "title": "بخشنامه نحوه محاسبه هزینه دادرسی",
            "subject": "هزینه دادرسی",
            "text": "متن کامل بخشنامه رئیس قوه قضائیه درباره هزینه دادرسی.",
            "year": "1403",
        },
        vector_score=0.81,
    )
    assert row["title"] == "بخشنامه نحوه محاسبه هزینه دادرسی"
    assert row["number"] == "9000/12345/100"
    assert row["ref"] == "9000/12345/100"
    assert row["date"] == "1403"
    assert row["issuer"] == "رئیس قوه قضائیه"
    assert row["subject"] == "هزینه دادرسی"
    assert "متن کامل بخشنامه" in row["summary"]
    assert row["category"] == "REGULATION"
    assert row["kind"] == "regulation"
    assert row["doc_type"] == "judiciary_circular"
    assert row["match_level"] == "JUDICIARY_CIRCULAR_VECTOR"
    assert row["vector_score"] == 0.81
    assert row["source"] == "qdrant:judiciary_circulars"


def test_is_circular_question():
    from output_apps.generated_modules.smartjudge import judiciary_circulars_retrieval as jc

    assert jc.is_circular_question("آخرین بخشنامه قوه قضائیه در مورد مهریه چیست؟") is True
    assert jc.is_circular_question("دستورالعمل جدید رئیس قوه درباره دادگاه صلح") is True
    assert jc.is_circular_question("شرایط فسخ قرارداد اجاره چیست؟") is False


def test_hits_to_rows_filters_score_and_inactive():
    from output_apps.generated_modules.smartjudge import judiciary_circulars_retrieval as jc

    payloads = [
        {"circular_no": "100/1", "title": "الف", "text": "محتوا", "year": 1402, "_vector_score": 0.40},
        {"circular_no": "100/2", "title": "ب", "text": "محتوا", "year": 1402, "_vector_score": 0.90, "is_active": False},
        {"circular_no": "100/3", "title": "ج", "text": "محتوا", "year": 1403, "_vector_score": 0.78},
        {"circular_no": "100/3", "title": "ج تکراری", "text": "محتوا", "year": 1403, "_vector_score": 0.72},
    ]
    rows = jc.hits_to_rows(payloads, cutoff=0.55, limit=3)
    assert len(rows) == 1
    assert rows[0]["number"] == "100/3"


def test_merge_circulars_dedups_against_iran_regulations_v3b():
    from output_apps.generated_modules.smartjudge import judiciary_circulars_retrieval as jc

    existing = [
        {
            "title": "بخشنامه نحوه محاسبه هزینه دادرسی",
            "number": "9000/12345/100",
            "doc_id": "reg-1",
            "category": "REGULATION",
        },
        {
            "title": "بخشنامه سازمان ثبت اسناد و املاک",
            "number": "1403/55",
            "doc_id": "reg-2",
            "category": "REGULATION",
        },
    ]
    circulars = [
        # Same circular_no as existing reg-1 -> must not duplicate
        jc.payload_to_row({"circular_no": "9000/12345/100", "title": "عنوان متفاوت", "text": "x", "year": "1403"}, 0.8),
        # Same normalized title (Arabic ي/ك vs Persian ی/ک) -> must not duplicate
        jc.payload_to_row({"circular_no": "999", "title": "بخشنامه سازمان ثبت اسناد و املاك", "text": "y", "year": "1403"}, 0.79),
        # Distinct circular -> must be appended
        jc.payload_to_row({"circular_no": "9000/777", "title": "دستورالعمل صلح و سازش", "text": "z", "year": "1403"}, 0.75),
    ]
    merged = jc.merge_circulars(existing, circulars)
    assert len(merged) == 3
    assert merged[-1]["number"] == "9000/777"


def test_retrieve_judiciary_circulars_with_mocks_and_embedder_guard(monkeypatch):
    from output_apps.generated_modules.smartjudge import judiciary_circulars_retrieval as jc

    monkeypatch.setenv("JUDICIARY_CIRCULARS_COLLECTION", "judiciary_circulars")

    async def _search(_vec, coll, k):
        assert coll == "judiciary_circulars"
        assert k >= 4
        return [
            {"circular_no": "10/1", "title": "بخشنامه آزمایشی", "subject": "آزمایش", "text": "متن", "year": "1403", "_vector_score": 0.82},
        ]

    # Wrong embedder -> skipped safely
    skipped = asyncio.run(
        jc.retrieve_judiciary_circulars(
            "بخشنامه چیست",
            embed=lambda _q: [0.1] * 1024,
            search=_search,
            embedder_name="other/model",
        )
    )
    assert skipped == []

    # Matching BAAI/bge-m3 embedder -> returns mapped row
    rows = asyncio.run(
        jc.retrieve_judiciary_circulars(
            "بخشنامه چیست",
            embed=lambda _q: [0.1] * 1024,
            search=_search,
            embedder_name="BAAI/bge-m3",
        )
    )
    assert len(rows) == 1
    assert rows[0]["number"] == "10/1"
