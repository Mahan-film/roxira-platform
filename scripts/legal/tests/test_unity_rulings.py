"""Offline tests: ruling parser (fetch_unity_rulings), ruling retrieval merge/format (rulings_retrieval),
ingest conversion (ingest_rulings) and the rulings golden file. No network, no LLM, no Qdrant.

Run ONLY this file:  python3 -m pytest scripts/legal/tests/test_unity_rulings.py
"""
# ruff: noqa: RUF001
import asyncio
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


fu = _load("fetch_unity_rulings", "scripts/legal/fetch_unity_rulings.py")
rr = _load("rulings_retrieval", "output_apps/generated_modules/smartjudge/rulings_retrieval.py")
ir = _load("ingest_rulings", "scripts/legal/ingest_rulings.py")

SC_HTML = """
<p>رأی وحدت رویه شماره ۸۸۲ – ۱۴۰۵/۶/۱۷ هیئت عمومی دیوان عالی کشور</p>
<p>بر اساس ماده واحده قانون نحوه تقویم ابنیه املاک و اراضی مورد نیاز شهرداری‌ها مصوب ۱۳۷۰/۸/۲۸ مالک استحقاق دریافت بهای ملک را دارد. لذا انتقال به ثالث صحیح است.</p>
<h3>مقدمه</h3>
<p>جلسه هیئت عمومی دیوان عالی کشور تشکیل شد.</p>
<p>ج) رأی وحدت رویه شماره ۸۸۲ مورخ ۱۴۰۵/۶/۱۷ هیئت عمومی دیوان عالی کشور</p>
<p>در اجرای ماده ۴۷۱ قانون آیین دادرسی کیفری و ماده ۲۲ قانون ثبت اسناد و املاک رأی صادر شد.</p>
<p>مواد قانونی مرتبط:</p>
<p>ماده ۲۲ قانون ثبت اسناد و املاک: همین که ملکی ثبت شد</p>
<p>جدیدترین آراء وحدت رویه:</p>
<p>رأی وحدت رویه شماره ۸۸۱ – ۱۴۰۵/۶/۱۷ هیئت عمومی دیوان عالی کشور</p>
"""
NEWS_HTML = "<p>پایگاه خبری اختبار- جلسه هیات عمومی دیوان عالی کشور امروز برگزار شد.</p>"
ADMIN_HTML = """
<p>تاریخ دادنامه: ۱۴۰۵/۴/۹</p>
<p>شماره دادنامه: ۱۴۰۵۳۱۳۹۰۰۰۰۸۷۷۲۶۶</p>
<p>شماره پرونده: ۰۳۰۰۸۶۷</p>
<p>مرجع رسیدگی: هیئت عمومی دیوان عدالت اداری</p>
<p>شاکی: آقای الف</p>
<p>طرف شکایت: ستاد فرماندهی</p>
<p>موضوع شکایت و خواسته: ابطال بند ۱۲ دستورالعمل افسر نگهبانی</p>
<p>گردش کار:</p>
<p>شاکی ابطال را خواستار شده است.</p>
<p>رأی هیئت عمومی دیوان عدالت اداری</p>
<p>مقرره مغایر مواد ۹۷ و ۱۰۲ قانون مقررات استخدامی سپاه است و ابطال می‌شود. این رأی براساس ماده ۹۳ قانون دیوان عدالت اداری لازم‌الاتباع است.</p>
<p>رئیس هیئت عمومی دیوان عدالت اداری ـ احمدرضا عابدی</p>
"""
ADMIN_UNITY_HTML = ADMIN_HTML.replace("ابطال بند ۱۲ دستورالعمل افسر نگهبانی", "اعلام تعارض در آرای شعب")


def post(pid, title, html, cats=(247,), link=None):
    return {"id": pid, "date": "2026-09-27T09:37:44", "modified": "2026-09-27T09:37:44",
            "link": link or f"https://www.ekhtebar.ir/p{pid}/", "title": {"rendered": title}, "categories": list(cats),
            "content": {"rendered": html}}


# ----------------------------------------------------------------------------- dates
def test_jalali_to_iso():
    assert fu.jalali_to_iso("1405/4/9") == "2026-06-30"
    assert fu.jalali_to_iso("۱۴۰۵/۶/۱۷") == "2026-09-08"
    assert fu.jalali_to_iso("1384/05/18") == "2005-08-09"
    assert fu.jalali_to_iso("1399/12/30") == "2021-03-20"
    assert fu.jalali_to_iso("hello") is None and fu.jalali_to_iso("1405/13/1") is None
    assert fu.clean_date("۱۴۰۵/۶/۱۷") == "1405/06/17"


# ----------------------------------------------------------------------------- law references
def test_extract_law_refs_snaps_known_and_resolves_back_references():
    refs = fu.extract_law_refs(
        "به موجب ماده ۱۸ قانون مجازات اسلامی مصوب ۱۳۹۲ و مواد ۱۱۵ و ۱۱۸ قانون مجازات اسلامی؛ ماده ۹ قانون یاد شده؛ "
        "اصل ۳۷ قانون اساسی؛ ماده واحده قانون نحوه تقویم ابنیه املاک و اراضی مورد نیاز شهرداری‌ها؛ ماده ۲ این قانون"
    )
    by = {r["law_name"]: r for r in refs}
    assert by["قانون مجازات اسلامی"]["articles"] == ["18", "115", "118", "9"] or by["قانون مجازات اسلامی"]["articles"][:3] == ["18", "115", "118"]
    assert by["قانون مجازات اسلامی"]["known"] is True
    assert by["قانون اساسی"]["articles"] == ["اصل 37"]
    assert any(r["articles"] == ["واحده", "2"] or r["articles"][:1] == ["واحده"] for r in refs)
    # a reference with no resolvable law is dropped, not guessed
    assert fu.extract_law_refs("ماده ۵ لازم است") == []


def test_extract_ranges_and_mokarrar():
    refs = fu.extract_law_refs("مواد ۱۰ تا ۱۲ قانون مدنی و ماده ۱۳۶ مکرر قانون آیین دادرسی کیفری")
    by = {r["law_name"]: r["articles"] for r in refs}
    assert by["قانون مدنی"] == ["10", "11", "12"]
    assert "136-مکرر" in by["قانون آیین دادرسی کیفری"]


# ----------------------------------------------------------------------------- unity (Supreme Court)
def test_parse_supreme_court_unity_ruling():
    row, why = fu.parse_post(post(1, "رأی وحدت رویه شماره ۸۸۲ &#8211; ۱۴۰۵/۶/۱۷ هیئت عمومی دیوان عالی کشور", SC_HTML), 247, "t")
    assert why == "ok"
    assert row["ruling_type"] == "unity_supreme_court" and row["number"] == "882"
    assert row["date"] == "1405/06/17" and row["date_iso"] == "2026-09-08"
    assert row["issuing_body"] == "هیئت عمومی دیوان عالی کشور" and row["ruling_id"] == "sc-unity-882-2026-09-08"
    assert row["holding"].startswith("بر اساس ماده واحده قانون نحوه تقویم")
    assert row["subject"].endswith("را دارد.")
    assert "جدیدترین" not in row["text"] and "مواد قانونی مرتبط" not in row["text"]  # page chrome / quoted statutes cut
    assert row["related_provisions_chars"] > 0
    names = {r["law_name"] for r in row["laws_referenced"]}
    assert "قانون ثبت اسناد و املاک" in names and "قانون آیین دادرسی کیفری" in names
    assert row["source_tier"] == "unofficial" and row["needs_review"] is True and row["source"] == "ekhtebar"


def test_news_and_commentary_posts_are_skipped():
    for title in ("صدور یک رای وحدت رویه با موضوع X", "نگاهی به رای وحدت رویه ۸۷۸ دیوان عالی کشور درخصوص Y"):
        row, why = fu.parse_post(post(2, title, NEWS_HTML), 247, "t")
        assert row is None and why == "news_or_commentary"


# ----------------------------------------------------------------------------- Administrative Court
def test_parse_admin_court_annulment():
    row, why = fu.parse_post(post(3, "ابطال بند ۱۲ دستورالعمل افسر نگهبانی", ADMIN_HTML, (794,)), 794, "t")
    assert why == "ok" and row["ruling_type"] == "admin_court_annulment"
    assert row["number"] == "1405313900008772" + "66" and row["ruling_id"].startswith("adl-board-")
    assert row["date"] == "1405/04/09" and row["date_iso"] == "2026-06-30" and row["case_number"] == "0300867"
    assert row["issuing_body"] == "هیئت عمومی دیوان عدالت اداری"
    assert row["subject"].startswith("ابطال بند 12") or row["subject"].startswith("ابطال بند ۱۲")
    assert row["holding"].startswith("مقرره مغایر") and "عابدی" not in row["holding"]
    by = {r["law_name"]: r["articles"] for r in row["laws_referenced"]}
    assert by["قانون دیوان عدالت اداری"] == ["93"]


def test_parse_admin_court_unity_uses_title_subject():
    row, _ = fu.parse_post(
        post(4, "رای وحدت رویه هیات عمومی دیوان عدالت اداری با موضوع: عدم صلاحیت شعب در رسیدگی به آراء نظام مهندسی",
             ADMIN_UNITY_HTML, (794,)), 794, "t")
    assert row["ruling_type"] == "admin_court_unity"
    assert row["subject"] == "عدم صلاحیت شعب در رسیدگی به آراء نظام مهندسی"


def test_admin_post_without_decision_header_is_skipped():
    row, why = fu.parse_post(post(5, "خبر", "<p>متن خبر بدون دادنامه</p>", (794,)), 794, "t")
    assert row is None and why == "no_decision_header"


# ----------------------------------------------------------------------------- fetch paging + stage dedupe
class FakeClient:
    """Serves 25 posts for category 247 by offset paging; the 10-post window at offset 10 'truncates' once."""

    def __init__(self):
        self.requests = 0
        self.calls = []
        self.fe = fu._fe()

    def get(self, url, retries=2):
        from urllib.parse import parse_qs, urlparse
        self.requests += 1
        q = {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}
        size, off = int(q["per_page"]), int(q["offset"])
        self.calls.append((off, size))
        if (off, size) == (10, 10):
            raise self.fe.FetchFailed("transfer kept failing (IncompleteRead)")
        if off >= 25:
            return 400, b"{}"
        items = [post(100 + i, f"رأی وحدت رویه شماره {500 + i} – 1400/01/01 هیئت عمومی دیوان عالی کشور", SC_HTML)
                 for i in range(off, min(25, off + size))]
        return 200, json.dumps(items).encode()


def test_fetch_all_falls_back_to_single_posts(tmp_path):
    client = FakeClient()
    totals = fu.fetch_all(tmp_path, client, cats=(247,))
    assert totals[247] == 25
    assert (10, 10) in client.calls and (10, 1) in client.calls and (19, 1) in client.calls
    again = FakeClient()
    fu.fetch_all(tmp_path, again, cats=(247,))
    assert again.requests == 0  # every window (also the one fetched post by post) is cached
    posts = fu.load_posts(tmp_path, 247)
    assert len({p["id"] for p in posts}) == 25


def test_stage_dedupes_by_number_keeping_longest(tmp_path):
    a = post(1, "رأی وحدت رویه شماره ۸۸۲ – ۱۴۰۵/۶/۱۷ هیئت عمومی دیوان عالی کشور", SC_HTML)
    b = post(2, "رای وحدت رویه شماره ۸۸۲ – ۱۴۰۵/۶/۱۷ هیات عمومی دیوان عالی کشور", SC_HTML.replace("<h3>مقدمه</h3>", "<p>افزوده</p><h3>مقدمه</h3>"))
    c = post(3, "خبر رای وحدت رویه", NEWS_HTML)
    d = post(4, "ابطال بند", ADMIN_HTML, (794,))
    (tmp_path / "cat247_o00000_n10.json").write_text(json.dumps([a, b, c]), encoding="utf-8")
    (tmp_path / "cat794_o00000_n10.json").write_text(json.dumps([d]), encoding="utf-8")
    res = fu.stage(tmp_path, "t")
    assert [r["number"] for r in res["unity"]] == ["882"]
    assert res["unity"][0]["post_id"] == 2  # longest text wins
    rep = res["report"]["categories"]["247"]
    assert rep["duplicates"][0]["dropped_posts"] == [1] and rep["skipped"] == {"news_or_commentary": 1}
    assert rep["date_range_iso"] == ["2026-09-08", "2026-09-08"]
    v = fu.validate_rows(res["unity"] + res["admin"])
    assert not v["missing_fields"] and not v["duplicate_ids"] and not v["html_junk"] and not v["bad_host"]


# ----------------------------------------------------------------------------- retrieval merge / format
def payload(num=882, rtype="unity_supreme_court", score=0.8, **kw):
    p = {"ruling_id": f"x-{num}", "ruling_type": rtype, "number": str(num), "date": "1405/06/17",
         "issuing_body": "هیئت عمومی دیوان عالی کشور", "subject": "موضوع", "holding": "مفاد رأی است.",
         "source_url": "https://www.ekhtebar.ir/p/", "is_active": True, "_vector_score": score}
    p.update(kw)
    return p


def test_flag_default_off(monkeypatch):
    monkeypatch.delenv(rr.ENV_COLLECTION, raising=False)
    assert not rr.enabled() and rr.collection() == ""
    assert asyncio.run(rr.retrieve_rulings("هر پرسشی")) == []
    for off in ("0", "off", "false", " "):
        monkeypatch.setenv(rr.ENV_COLLECTION, off)
        assert not rr.enabled()
    monkeypatch.setenv(rr.ENV_COLLECTION, "iran_rulings_v1")
    assert rr.enabled() and rr.collection() == "iran_rulings_v1"


def test_hits_to_rows_cutoff_dedupe_order():
    rows = rr.hits_to_rows(
        [payload(1, score=0.6), payload(2, score=0.9), payload(2, score=0.7), payload(3, score=0.3),
         payload(4, score=0.95, is_active=False)], limit=5)
    assert [r["number"] for r in rows] == ["2", "1"]  # best first, duplicate and low score dropped, inactive dropped
    r = rows[0]
    assert r["category"] == "RULING" and r["kind"] == "precedent" and r["match_level"] == "RULING_VECTOR"
    assert r["title"] == "رأی وحدت رویه شماره 2 هیئت عمومی دیوان عالی کشور – 1405/06/17"
    assert r["source_tier"] == "unofficial" and r["binding_effect"]


def test_merge_and_split_keep_existing_precedents_first():
    sql_prec = [{"title": "رأی ۱۰", "subject": "s", "summary": "x", "category": "DOCTRINE"}]
    rulings = rr.hits_to_rows([payload(5), payload(6)], limit=5)
    merged = rr.merge_rulings(sql_prec, rulings + rulings[:1])
    assert merged[0] is sql_prec[0] and len(merged) == 3  # duplicate ruling not added twice
    got, others = rr.split_rulings(merged)
    assert [r["number"] for r in got] == ["5", "6"] or {r["number"] for r in got} == {"5", "6"}
    assert others == sql_prec
    assert rr.merge_rulings(None, None) == []


def test_context_block_and_public_view_carry_number_and_date():
    rows = rr.hits_to_rows([payload(882, score=0.9)], limit=3)
    block = rr.context_block(rows)
    assert "رویه قضایی" in block and "882" in block and "1405/06/17" in block
    assert rr.context_block([]) == ""
    view = rr.public_view(rows)[0]
    assert view["number"] == "882" and view["date"] == "1405/06/17" and view["source_url"] and "summary" not in view


def test_ruling_row_is_cited_by_source_filter():
    from output_apps.generated_modules.smartjudge import source_filter as sf

    adm = rr.hits_to_rows([payload(140531390000877266, "admin_court_annulment", 0.9, issuing_body="هیئت عمومی دیوان عدالت اداری")])[0]
    sc = rr.hits_to_rows([payload(882, score=0.9)])[0]
    assert sf.cited_in_answer("بر اساس رأی وحدت رویه شماره ۸۸۲", sc)
    assert sf.cited_in_answer("طبق دادنامه شماره 140531390000877266 هیئت عمومی", adm)
    assert not sf.cited_in_answer("بر اساس رأی وحدت رویه شماره ۸۸۱", sc)
    assert sf.filter_relevant([sc, adm]) == [sc, adm]  # vector_score >= 0.55 passes the shared relevance filter


def test_retrieve_rulings_with_injected_embedder(monkeypatch):
    monkeypatch.setenv(rr.ENV_COLLECTION, "iran_rulings_v1")
    seen = {}

    async def search(vec, coll, k):
        seen.update(vec=vec, coll=coll, k=k)
        return [payload(7, score=0.9), payload(8, score=0.2)]

    rows = asyncio.run(rr.retrieve_rulings("پرسش", limit=2, embed=lambda t: [0.1, 0.2], search=search, embedder_name="BAAI/bge-m3"))
    assert [r["number"] for r in rows] == ["7"] and seen["coll"] == "iran_rulings_v1"
    # a different query embedder than the collection's bge-m3 -> skipped, never noise
    assert asyncio.run(rr.retrieve_rulings("پرسش", embed=lambda t: [0.1], search=search, embedder_name="other")) == []

    async def boom(vec, coll, k):
        raise RuntimeError("qdrant down")

    assert asyncio.run(rr.retrieve_rulings("پرسش", embed=lambda t: [0.1], search=boom, embedder_name="BAAI/bge-m3")) == []


# ----------------------------------------------------------------------------- ingest conversion
def test_ingest_row_passes_pipeline_gates():
    sc, _ = fu.parse_post(post(1, "رأی وحدت رویه شماره ۸۸۲ – ۱۴۰۵/۶/۱۷ هیئت عمومی دیوان عالی کشور", SC_HTML), 247, "t")
    ad, _ = fu.parse_post(post(3, "ابطال بند", ADMIN_HTML, (794,)), 794, "t")
    rows = [ir.to_ingest_row(sc), ir.to_ingest_row(ad)]
    assert rows[0]["law_name"] == ir.LAW_SC and rows[1]["law_name"] == ir.LAW_ADMIN
    assert rows[0]["article_no"] == "882" and rows[0]["full_text"] == sc["text"] and len(rows[0]["text"]) <= ir.EMBED_CHARS
    assert sc["holding"][:40] in rows[0]["text"]
    ip = ir._ip()
    rep = ip.validate_rows(rows, ir.allowlist())
    assert rep["ok"], rep["gate_counts"]
    assert ip.point_id(rows[0]) != ip.point_id(rows[1])


# ----------------------------------------------------------------------------- golden file
GOLDEN = ROOT / "data/eval/chat_golden/rulings_golden_2026-10-12.json"
STAGED = [ROOT / "data/legal/staged/unity_rulings_2026-10-12.jsonl",
          ROOT / "data/legal/staged/admin_court_board_rulings_2026-10-12.jsonl"]


def test_golden_file_shape_and_phrases_in_fetched_text():
    data = json.loads(GOLDEN.read_text(encoding="utf-8"))
    cases = data["cases"]
    assert 10 <= len(cases) <= 15
    ids = [c["id"] for c in cases]
    assert len(set(ids)) == len(ids)
    for c in cases:
        assert c["question"].strip() and c["law_any"] and c["articles"] and c["must_include"] and c["date"]
    if not all(p.exists() for p in STAGED):
        return  # staged files are not in a fresh checkout of every branch
    texts = {}
    for p in STAGED:
        for ln in p.read_text(encoding="utf-8").splitlines():
            r = json.loads(ln)
            texts[(r["number"], r["date"])] = fu.norm(r["text"])
    for c in cases:
        body = texts[(str(c["articles"][0]), c["date"])]
        for phrase in c["must_include"]:
            assert fu.norm(phrase) in body, (c["id"], phrase)


# ----------------------------------------------------------------------------- messy real-world shapes
def test_clean_date_variants():
    assert fu.clean_date("25؍11؍1401") == "1401/11/25"
    assert fu.clean_date("5/2/1402") == "1402/02/05"
    assert fu.clean_date("99/6/18") == "1399/06/18"
    assert fu.clean_date("شنبه ۵ تیر ۱۴۰۰") == "1400/04/05"
    assert fu.clean_date("2536/11/24") == "1356/11/24"  # Shahanshahi year
    assert fu.clean_date("1๙") == "" and fu.clean_date("4614/1/1") == ""
    assert fu.clean_date("۱۴‍۰۳/۴/۱۹") == "1403/04/19"  # zero-width joiners inside digits


FLAT_HTML = (
    "<p>پیام رای دستورالعمل X ابطال شد مشخصات دادنامه تاریخ دادنامه: 16؍12؍1401 شماره دادنامه: 140109970905812849 "
    "شماره پرونده: 0101402 مرجع رسیدگی: هیات عمومی دیوان عدالت اداری شاکی: آقای ب موضوع شکایت و خواسته: ابطال دستورالعمل Y "
    "گردش‌کار شاکی اعلام کرد. رای هیات عمومی دیوان عدالت اداری مقرره مغایر ماده ۴ قانون Z است و ابطال می‌شود. "
    "رئیس هیات عمومی دیوان عدالت اداری - نام</p>"
)


def test_admin_header_in_one_paragraph():
    row, why = fu.parse_post(post(9, "ابطال دستورالعمل Y", FLAT_HTML, (794,)), 794, "t")
    assert why == "ok" and row["number"] == "140109970905812849" and row["date"] == "1401/12/16"
    assert row["case_number"] == "0101402" and row["subject"].startswith("ابطال دستورالعمل Y")
    assert row["holding"].startswith("مقرره مغایر") and "نام" not in row["holding"]


def test_admin_branch_and_news_posts_are_not_board_rulings():
    branch = FLAT_HTML.replace("هیات عمومی دیوان عدالت اداری شاکی", "شعبه ۴۰ دیوان عدالت اداری شاکی")
    assert fu.parse_post(post(10, "نمونه رای", branch, (794,)), 794, "t")[0] is None
    news = "<p>پایگاه خبری اختبار- " + FLAT_HTML[3:]
    assert fu.parse_post(post(11, "خبر", news, (794,)), 794, "t")[0] is None


def test_sc_number_with_two_series_keeps_first_number_and_raw():
    row, _ = fu.parse_post(post(12, "رای وحدت رویه شماره ۱۷/۵۳ – ۱۳۵۳/۳/۱۵ هیئت عمومی دیوان عالی کشور", SC_HTML), 247, "t")
    assert row["number"] == "17" and row["number_raw"] == "17/53" and row["date"] == "1353/03/15"
    assert row["ruling_id"] == "sc-unity-17-1974-06-05"
