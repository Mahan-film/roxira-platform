"""Offline tests for scripts/legal/fetch_nezamat_wp.py (no network, no LLM)."""
# ruff: noqa: RUF001
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("fetch_nezamat_wp", ROOT / "scripts" / "legal" / "fetch_nezamat_wp.py")
nz = importlib.util.module_from_spec(spec)
sys.modules["fetch_nezamat_wp"] = nz
spec.loader.exec_module(nz)

LAW_HTML = """
<p><strong>فصل اول- تعاریف</strong></p>
<p>‌ماده ۱ – نظام صنفی: قواعد و مقرراتی است که امور مربوط به سازمان را تعیین می‌کند.</p><hr />
<p>‌ماده ۲ – فرد صنفی: هر شخص حقیقی یا حقوقی.</p>
<p>تبصره- [اصلاحی ۱۳۹۲/۶/۱۲]<br />صنوفی که قانون خاص دارند مستثنی هستند.</p>
<p class="elementor-heading-title elementor-size-default" style="text-align:center;">[<a href="/post-1/">آیین‌نامه اجرایی چگونگی صدور مجوز</a>]</p>
<hr />
<p>ماده ۳‌ـ [اصلاحی ۱۴۰۳/۵/۲]<br />پروانه کسب مجوزی است که صادر می‌شود.</p><hr />
<p>ماده ۴- [قانون اصلاح قانون نظام صنفی کشور، مصوب ۱۳۹۲/۶/۱۲<br />ماده ۱ـ نام مجمع به اتاق تغییر می‌کند.<br />ماده ۲ـ متن دیگر.]</p><hr />
<p>ماده ۵ – [حذف ۱۳۹۲/۶/۱۲]</p>
<p>ماده ۶ – متن ماده ششم.</p>
<p>قانون فوق مشتمل بر شش ماده در جلسه علنی تصویب شد.</p>
<p>رییس مجلس شورای اسلامی</p>
"""


def stage(text, law_extra=None, sequential=False):
    cf = nz._load("corpus_fill", "scripts/legal/corpus_fill.py")
    text, extras = nz.prep_text(text, sequential)
    law = {"id": "t", "title_fa": "قانون آزمایشی", "stage": {"law_id": "nezamat_t", "law_name": "قانون آزمایشی",
           "law_type": "COMMERCIAL", "source_tier": "unofficial", "approval_date": "1382-12-24", **(law_extra or {})}}  # fmt: skip
    res = cf.stage_law(law, text, {"source_url": "https://nezamat.ir/post-1/", "source_label": "nezamat.ir"})
    return res, extras


def test_html_to_text_drops_pointer_paragraphs_and_keeps_law_text():
    text, refs = nz.html_to_text(LAW_HTML)
    assert refs == ["آیین‌نامه اجرایی چگونگی صدور مجوز"]
    assert "چگونگی صدور مجوز" not in text
    assert "تبصره- [اصلاحی ۱۳۹۲/۶/۱۲]" in text and "ماده ۲ – فرد صنفی" in text


def test_article_split_amendment_tags_zwnj_sep_and_quoted_amending_text():
    text, _ = nz.html_to_text(LAW_HTML)
    res, extras = stage(text)
    labels = [r["article_label"] for r in res["rows"]]
    # «ماده ۳‌ـ» (ZWNJ before the dash) is a marker; the quoted «ماده ۱ـ / ماده ۲ـ» inside [...] are not
    assert labels == ["ماده 1", "ماده 2", "ماده 3", "ماده 4", "ماده 6"], labels
    by = {r["article_label"]: r for r in res["rows"]}
    assert by["ماده 3"]["amended_on"] == "1403-05-02"
    assert "اتاق تغییر می" in by["ماده 4"]["text"] and "ماده 2" not in by["ماده 4"]["article_label"]
    assert by["ماده 1"]["chapter"] == "فصل اول- تعاریف"
    assert by["ماده 6"]["text"].endswith("متن ماده ششم.")  # footer «قانون فوق مشتمل بر» is cut
    assert by["ماده 1"]["approval_date"] == "1382-12-24" and by["ماده 1"]["source_tier"] == "unofficial"
    # deterministic: same input, same rows
    res2, _ = stage(text)
    assert [r["content_hash"] for r in res["rows"]] == [r["content_hash"] for r in res2["rows"]]


def test_removed_article_one_liners_become_inactive_not_duplicates():
    text, _ = nz.html_to_text(LAW_HTML)
    _, extras = stage(text)
    assert extras["removed"] == [("ماده 5", "5", "[حذف ۱۳۹۲/۶/۱۲]")] or extras["removed"][0][:2] == ("ماده 5", "5")


def test_range_repeal_note_expands_and_ignores_partial_articles():
    assert nz.expand_number_spec("۲۱، ۲۲، ۴۰، ۴۶ تا ۴۹ و بند ۴ ماده ۹۳") == [21, 22, 40, 46, 47, 48, 49]
    assert nz.expand_number_spec("۱ تا ۹۰۰۰") == []  # implausible range is not trusted
    note = "[مواد ۲۱ تا ۲۳ قانون تجارت، مصوب ۱۳۱۱، به موجب لایحه ۱۳۴۷، نسخ شده است.]"
    text, extras = nz.prep_text("ماده ۱ – الف\n\n" + note + "\n\nماده ۲۴ – ب\n")
    assert [x[0] for x in extras["removed"]] == ["ماده 21", "ماده 22", "ماده 23"]
    assert "نسخ شده" not in text


def test_sequential_mode_folds_quoted_articles_of_an_amended_law():
    src = ("ماده ۱- متن زیر به عنوان ماده ۷ مکرر الحاق می‌شود:\n\nماده ۷ مکرر- متن الحاقی.\n\n"
           "ماده ۲- دو ماده الحاق می‌شود:\n\nماده ۳۰- الف.\n\nماده ۳۱- ب.\n\nماده ۳- پایان.\n")
    res, extras = stage(src, sequential=True)
    assert [r["article_label"] for r in res["rows"]] == ["ماده 1", "ماده 2", "ماده 3"]
    assert extras["skipped_markers"] == 3 and "ماده 30- الف." in res["rows"][1]["text"]
    plain, _ = stage(src)
    assert len(plain["rows"]) == 6  # without the switch the quoted articles would be split out


def test_older_duplicate_version_is_superseded():
    rows = [{"article_label": "ماده 244", "amended_on": "1400-03-02", "review_reasons": [], "status": "VALID", "is_active": True},
            {"article_label": "ماده 244 (2)", "amended_on": "1380-11-27", "review_reasons": [], "status": "VALID", "is_active": True}]  # fmt: skip
    res = {"rows": rows, "repealed_rows": []}
    assert nz.supersede_older_duplicates(res) == 1
    assert [r["article_label"] for r in res["rows"]] == ["ماده 244"]
    old = res["repealed_rows"][0]
    assert old["is_active"] is False and "superseded_version_same_number" in old["review_reasons"]


def test_parse_meta_reads_dates_and_number():
    page = ("<html><body><h1>t</h1><div>تاریخ تصویب</div><div>۱۳۸۲/۱۲/۲۴</div><div>تاریخ ثبت</div><div>1383/01/10</div>"
            "<div>شماره</div><div>64873/ت65882ه</div><div>تاریخ انتشار</div><div>۱۳۸۳/۰۱/۲۹</div></body></html>")
    m = nz.parse_meta(page)
    assert m["approval_iso"] == "1382-12-24" and m["published_iso"] == "1383-01-29" and m["number"].startswith("64873")


def test_similarity_ignores_spelling_tags_and_flags_real_changes():
    a = "ماده 3 قانون: دستگاههای اجرائی و تشکلهای [اصلاحی ۱۳۹۲/۶/۱۲] مکلفند."
    b = "دستگاه های اجرایی و تشکل های مکلفند."
    assert nz.similarity(a, b) > 0.97
    c = "دستگاه های اجرایی و تشکل های مجازند حداکثر ده میلیون ریال بپردازند."
    assert nz.similarity(a, c) < 0.9


def test_compare_rows_categories():
    rows = {"قانون الف|id1": [{"article_label": "ماده 1", "text": "ماده 1 قانون الف: متن یکسان است."},
                              {"article_label": "ماده 2", "text": "ماده 2 قانون الف: بسیار متفاوت با متن دیگر منبع"},
                              {"article_label": "ماده 9", "text": "ماده 9 قانون الف: x"}]}  # fmt: skip
    other = {"قانون الف|id1": {"ماده 1": "متن یکسان است.", "ماده 2": "چیز دیگری کاملا نامرتبط"}}
    out = {r["article"]: r["result"] for r in nz.compare_rows(rows, other)}
    assert out == {"ماده 1": "match", "ماده 2": "MISMATCH", "ماده 9": "missing_in_other"}
    assert nz.compare_rows(rows, {})[0]["result"] == "no_other_source"


def test_sample_rows_is_seeded_and_per_law():
    rows = [{"law_name": "L", "law_id": "a", "article_label": f"ماده {i}", "text": "x"} for i in range(100)]
    s1 = nz.sample_rows(rows, None, 0.05, 7)
    s2 = nz.sample_rows(rows, None, 0.05, 7)
    assert s1 == s2 and len(s1["L|a"]) == 5 and len(nz.sample_rows(rows, 3, None, 1)["L|a"]) == 3


def _client(responses):
    seen = []

    def opener(url, headers):
        seen.append(url)
        return responses(url)

    return nz.Client(delay=0, max_requests=10, opener=opener, sleep=lambda s: None), seen


def test_client_robots_host_block_and_invalid_category():
    posts = {"id": 5, "link": "https://nezamat.ir/post-5/", "title": {"rendered": "x"}, "categories": [130, 327],
             "content": {"rendered": "<p>ماده ۱ – x</p>"}}  # fmt: skip

    def resp(url):
        if url.endswith("robots.txt"):
            return 200, {}, b"User-agent: *\nDisallow: /wp-admin/\n"
        return 200, {}, json.dumps(posts).encode()

    c, seen = _client(resp)
    try:
        nz.fetch_post(c, 5)
        raise AssertionError("invalid-category post must not be fetched")
    except nz.FetchFailed as e:
        assert "327" in str(e)
    for bad in ("https://www.ekhtebar.ir/x", "https://nezamat.ir/wp-admin/x", "https://qavanin.ir/"):
        try:
            c.get(bad)
        except nz.Blocked:
            continue
        raise AssertionError(bad)


def test_client_stops_on_403_and_on_challenge_page():
    c, _ = _client(lambda u: (200, {}, b"User-agent: *\n") if u.endswith("robots.txt") else (403, {}, b"no"))
    try:
        c.get("https://nezamat.ir/x")
        raise AssertionError
    except nz.Blocked:
        pass
    page = "<html><title></title><h1>Transferring to the website</h1></html>".encode()
    c2, _ = _client(lambda u: (200, {}, b"User-agent: *\n") if u.endswith("robots.txt") else (200, {}, page))
    try:
        c2.get("https://nezamat.ir/y")
        raise AssertionError
    except nz.Blocked:
        pass
    # an HTML page served as robots.txt (challenge) = disallow all
    c3, _ = _client(lambda u: (200, {}, b"<html>challenge</html>"))
    try:
        c3.get("https://nezamat.ir/z")
        raise AssertionError
    except nz.Blocked:
        pass


def test_request_budget_is_enforced():
    c = nz.Client(delay=0, max_requests=2, opener=lambda u, h: (200, {}, b"User-agent: *\n"), sleep=lambda s: None)
    c.get("https://nezamat.ir/a")  # robots + 1 = 2 requests
    try:
        c.get("https://nezamat.ir/b")
        raise AssertionError
    except nz.Blocked as e:
        assert "budget" in str(e)


def test_config_and_allowlist_are_consistent():
    cfg = json.loads((ROOT / "config" / "nezamat_laws.json").read_text(encoding="utf-8"))
    al = json.loads((ROOT / "config" / "legal_allowlist_nezamat.json").read_text(encoding="utf-8"))
    names = {x["name"] for x in al["laws"]}
    ids = [x["id"] for x in cfg["laws"]]
    assert len(ids) == len(set(ids)) and all(x["status"] == "proposed" for x in al["laws"])
    for law in cfg["laws"]:
        assert law["stage"]["law_name"] in names, law["id"]
        assert law["stage"]["source_tier"] == "unofficial" and law["sources"]["nezamat"]["post_id"]
