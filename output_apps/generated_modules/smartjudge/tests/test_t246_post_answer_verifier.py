"""Offline adversarial unit tests for T246 deterministic post-answer verifier (#985)."""


def _verify():
    from output_apps.generated_modules.smartjudge.post_answer_verifier import verify_post_answer
    return verify_post_answer


def test_valid_grounded_answer_passes_and_emits_sse_event():
    verify = _verify()
    chunks = [
        {
            "law_name": "قانون مدنی",
            "article_no": "10",
            "authority_tier": 1,
            "source_tier": "official",
            "status": "enacted",
            "valid_from": "1307/02/18",
            "summary": "طبق ماده ۱۰ قانون مدنی مهلت اعتراض ۲۰ روز است.",
        }
    ]
    res = verify(
        "بر اساس ماده ۱۰ قانون مدنی مهلت اعتراض ۲۰ روز است.",
        chunks,
        cited_items=[{"law_name": "قانون مدنی", "article_no": "10"}],
        as_of_date="1405/09/04",
    )
    assert res.passed is True
    assert res.action == "pass"
    assert res.reasons == []
    evt = res.to_sse_event()
    assert evt["event"] == "verification"
    assert evt["data"]["passed"] is True


def test_catches_phantom_citation():
    verify = _verify()
    chunks = [
        {
            "law_name": "قانون مدنی",
            "article_no": "10",
            "authority_tier": 1,
            "source_tier": "official",
            "status": "enacted",
            "summary": "قراردادهای خصوصی نافذ است.",
        }
    ]
    res = verify(
        "طبق ماده ۹۹۹ قانون مدنی قرارداد نافذ است.",
        chunks,
        cited_items=[{"law_name": "قانون مدنی", "article_no": "999"}],
    )
    assert res.passed is False
    assert "phantom_citation" in res.reasons
    assert len(res.phantom_citations) == 1


def test_catches_wrong_deadline_or_ungrounded_number():
    verify = _verify()
    chunks = [
        {
            "law_name": "قانون آیین دادرسی مدنی",
            "article_no": "336",
            "authority_tier": 1,
            "source_tier": "official",
            "status": "enacted",
            "summary": "مهلت تجدیدنظرخواهی ۲۰ روز است.",
        }
    ]
    res = verify("مهلت تجدیدنظرخواهی ۶۰ روز است.", chunks)
    assert res.passed is False
    assert "ungrounded_number" in res.reasons
    assert "60" in res.ungrounded_numbers
    assert res.action == "regenerate_quote_only"


def test_catches_repealed_or_out_of_date_chunk():
    verify = _verify()
    chunks = [
        {
            "law_name": "قانون قدیم",
            "article_no": "5",
            "authority_tier": 1,
            "status": "repealed",
            "valid_from": "1350/01/01",
            "valid_to": "1390/01/01",
            "summary": "حکم منسوخ‌شده با عدد ۵.",
        }
    ]
    res = verify("طبق ماده ۵ قانون قدیم", chunks, as_of_date="1405/09/04")
    assert res.passed is False
    assert "repealed_or_out_of_date" in res.reasons
    assert res.action == "abstain"


def test_catches_unofficial_only_authority():
    verify = _verify()
    chunks = [
        {
            "law_name": "شرح حقوقی",
            "article_no": "1",
            "authority_tier": 3,
            "status": "enacted",
            "summary": "تفسیر غیررسمی ماده ۱.",
        }
    ]
    res = verify("تفسیر ماده ۱", chunks, require_authoritative=True)
    assert res.passed is False
    assert "no_authoritative_source" in res.reasons
    assert res.has_authoritative_source is False
    assert res.action == "abstain"
