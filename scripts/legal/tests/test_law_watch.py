"""Offline tests for scripts/legal/law_watch.py (no network, no LLM)."""
# ruff: noqa: RUF001
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("law_watch", ROOT / "scripts" / "legal" / "law_watch.py")
lw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lw)

LAWS = ["قانون مدنی", "قانون آیین دادرسی کیفری", "قانون صدور چک (اصلاحی ۱۳۹۷)", "قانون مجازات اسلامی"]


def item(title, cats, text="", fresh=True, pid=1):
    return {"post_id": pid, "title": title, "categories": cats, "text": text, "excerpt": "", "fresh": fresh,
            "date": "2026-10-01T10:00:00", "modified": "2026-10-01T10:00:00", "link": f"https://www.ekhtebar.ir/p{pid}/",
            "text_sha256": "x"}


def test_amendment_links_law_and_articles():
    r = lw.classify_item(item("قانون اصلاح ماده ۱۰ و ۱۱ قانون مدنی", [127]), LAWS)
    assert r["change_type"] == "amendment" and r["effect"] == "modifies"
    assert r["law_refs"][0]["law_name"] == "قانون مدنی"
    assert r["law_refs"][0]["article_nos"] == ["10", "11"]
    assert r["proposed_actions"][0]["action"] == "add_new_version_and_supersede"
    assert r["status"] == "proposed" and r["source"] == "ekhtebar.ir"


def test_repeal_and_annulment_and_unity():
    rep = lw.classify_item(item("لغو ماده ۵ قانون صدور چک", [24]), LAWS)
    assert rep["change_type"] == "repeal"
    assert rep["proposed_actions"][0]["set"]["is_active"] is False
    ann = lw.classify_item(item("ابطال تبصره یک ماده ۷۲ آیین‌نامه اجرایی قانون معادن", [794]), LAWS)
    assert ann["change_type"] == "annulment" and ann["effect"] == "annuls"
    uni = lw.classify_item(item("رای وحدت رویه شماره ۸۸۲ هیئت عمومی دیوان عالی کشور", [247]), LAWS)
    assert uni["change_type"] == "unity_ruling" and uni["issuer"] == "دیوان عالی کشور"
    both = lw.classify_item(item("رای وحدت رویه هیات عمومی دیوان عدالت اداری با موضوع X", [794]), LAWS)
    assert both["change_type"] == "unity_ruling"


def test_other_types():
    assert lw.classify_item(item("بخشنامه تعیین نرخ مالیات", [1072]), LAWS)["change_type"] == "circular"
    assert lw.classify_item(item("تصویب نامه درخصوص معیشت", [24]), LAWS)["change_type"] == "cabinet_decision"
    assert lw.classify_item(item("طرح اصلاح قانون مدنی", [1890, 127]), LAWS)["change_type"] == "bill"
    assert lw.classify_item(item("صورتجلسه نشست قضایی با موضوع Y", [5525]), LAWS)["change_type"] == "judicial_procedure"
    assert lw.classify_item(item("نظریه مشورتی درباره Z", [826]), LAWS)["change_type"] == "advisory_opinion"
    n = lw.classify_item(item("خبر مجلس", [539]), LAWS)
    assert n["change_type"] == "news" and not n["ingest_eligible"] and n["text"] == ""


def test_old_post_edit_is_not_new_act():
    r = lw.classify_item(item("قانون اصلاح قانون مدنی", [127], fresh=False), LAWS)
    assert r["fresh"] is False and r["effect"] == "informs" and not r["ingest_eligible"]
    assert r["proposed_actions"][0]["action"] == "recheck_corpus_text"


def test_ambiguous_flagged_for_llm():
    r = lw.classify_item(item("اصلاح مقررات سازمان", [127]), LAWS)
    assert r["change_type"] == "amendment" and r["needs_llm"] is True
    assert r["ingest_eligible"] is False


def test_article_extraction_and_digits():
    assert "20-mokarrar" in lw.extract_articles("ماده 20 مکرر")
    arts = lw.extract_articles("ماده ۱۲ و ۱۴")
    assert arts == ["12", "14"]


def test_llm_budget_and_http_injected(tmp_path, monkeypatch):
    monkeypatch.setattr(lw, "STATE_DIR", tmp_path)
    monkeypatch.setattr(lw, "pick_llm_model", lambda: ("deepseek/deepseek-v4.1-flash", 0.3, 1.2))
    sent = {}

    def post(body, key):
        sent.update(body)
        return {"choices": [{"message": {"content": '{"change_type": "repeal", "law_name": "قانون مدنی", "articles": ["5"]}'}}],
                "usage": {"prompt_tokens": 800, "completion_tokens": 50}}

    it = item("اصلاح مقررات سازمان", [127])
    rec = lw.classify_item(it, LAWS)
    out = lw.llm_classify(rec, it, http_post=post)
    assert out["change_type"] == "repeal" and out["ingest_eligible"] is False
    assert sent["reasoning"] == {"enabled": False} and sent["model"].startswith("deepseek/")
    assert json.loads((tmp_path / "llm_budget.json").read_text())["spent"] < lw.DAILY_LLM_CAP_USD
    (tmp_path / "llm_budget.json").write_text(json.dumps({"day": lw.dt.date.today().isoformat(), "spent": 0.02}))
    assert lw.llm_classify(rec, it, http_post=post) is None  # cap reached


def test_poll_classify_stage_digest_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(lw, "STATE_DIR", tmp_path / "state")
    posts = [
        {"id": 7, "date": "2999-01-01T00:00:00", "modified": "2999-01-01T01:00:00", "link": "https://www.ekhtebar.ir/a/",
         "title": {"rendered": "قانون اصلاح ماده ۱۰ قانون مدنی"}, "excerpt": {"rendered": "<p>x</p>"}, "categories": [127]},
        {"id": 8, "date": "2999-01-01T00:00:00", "modified": "2999-01-01T02:00:00", "link": "https://www.ekhtebar.ir/b/",
         "title": {"rendered": "اخبار روز"}, "excerpt": {"rendered": ""}, "categories": [539]},
    ]
    calls = []

    def transport(url):
        calls.append(url)
        if "/posts/7?" in url:
            return json.dumps({"content": {"rendered": "<p>ماده ۱۰ اصلاح شد</p>"}}).encode(), {}
        return json.dumps(posts if "page=1" in url else []).encode(), {}

    f = lw.Fetcher(transport=transport, delay=0, sleep=lambda s: None)
    args = lw.argparse.Namespace(since_days=30, max_pages=5, no_text=False)
    assert lw.cmd_poll(args, f) == 0
    assert all("ekhtebar.ir" in c for c in calls)
    assert json.loads((tmp_path / "state" / "state.json").read_text())["cursor_modified"] == "2999-01-01T02:00:00"
    assert lw.cmd_classify(lw.argparse.Namespace(llm=False)) == 0
    out = tmp_path / "staged"
    assert lw.cmd_stage(lw.argparse.Namespace(out_dir=str(out))) == 0
    files = list(out.glob("law_watch_*.jsonl"))
    assert len(files) == 1
    rows = [json.loads(line) for line in files[0].read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 1 and rows[0]["change_type"] == "amendment" and rows[0]["status"] == "proposed"
    assert rows[0]["record_type"] == "law_change" and rows[0]["text"].startswith("ماده")
    # second stage run stages nothing and never rewrites the existing file
    before = files[0].read_text(encoding="utf-8")
    assert lw.cmd_stage(lw.argparse.Namespace(out_dir=str(out))) == 0
    assert files[0].read_text(encoding="utf-8") == before and len(list(out.glob("*.jsonl"))) == 1
    md = lw.render_digest(lw.read_jsonl(tmp_path / "state" / "changes.jsonl"), "2026-10-12")
    assert "amendment" in md and "news" in md


def test_fetcher_refuses_other_hosts():
    f = lw.Fetcher(transport=lambda u: (b"", {}), delay=0, sleep=lambda s: None)
    for bad in ("https://rc.majlis.ir/x", "https://qavanin.ir/", "https://dotic.ir/"):
        try:
            f.get(bad)
        except ValueError:
            continue
        raise AssertionError(bad)


def test_offline_poll_keeps_cursor(tmp_path, monkeypatch):
    monkeypatch.setattr(lw, "STATE_DIR", tmp_path)

    def down(url):
        raise OSError("no route")

    f = lw.Fetcher(transport=down, delay=0, sleep=lambda s: None)
    assert lw.cmd_poll(lw.argparse.Namespace(since_days=3, max_pages=2, no_text=True), f) == 3


def test_bill_vs_law_split():
    # category 1890 or a bill cue wins, even with a law category present
    assert lw.classify_item(item("قانون ملی توسعه X", [15, 1890, 127]), LAWS)["change_type"] == "bill"
    assert lw.classify_item(item("پیش‌نویس قانون Y", [127]), LAWS)["change_type"] == "bill"
    assert lw.classify_item(item("لایحه حمایت از Z", [127]), LAWS)["change_type"] == "bill"
    # enacted cue or recent year -> new_law
    r = lw.classify_item(item("قانون ملی توسعه هوش مصنوعی", [15, 127]) | {"excerpt": "برای دانلود فایل ابلاغی قانون کلیک کنید"}, LAWS)
    assert r["change_type"] == "new_law" and r["ingest_eligible"]
    r = lw.classify_item(item("قانون حمایت از W", [127]) | {"excerpt": "مصوب ۱۴۰۵/۶/۱"}, LAWS)
    assert r["change_type"] == "new_law"
    # old library page of a historical law is not a new act
    r = lw.classify_item(item("قانون اصول تشکیلات عدلیه", [127]) | {"excerpt": "مصوب ۱۳۰۷/۴/۲۷ کمیسیون مجلس"}, LAWS)
    assert r["change_type"] == "law_text" and not r["ingest_eligible"]
    # cabinet/president resolutions are resolutions, not laws
    assert lw.classify_item(item("مصوبه پرداخت کمک رفاهی", [15, 24]), LAWS)["change_type"] == "resolution"


def test_smtp_env_parsed_not_executed(tmp_path, monkeypatch):
    f = tmp_path / "roxira.env"
    f.write_text('OTHER_KEY=zzz\nexport BACKUP_SMTP_USER="u@example.test"\nBACKUP_NOTIFY_TO=n@example.test\n$(touch pwned)\n')
    for k in lw.SMTP_KEYS:
        monkeypatch.delenv(k, raising=False)
    assert sorted(lw.load_smtp_env(f)) == ["BACKUP_NOTIFY_TO", "BACKUP_SMTP_USER"]
    assert lw.os.environ["BACKUP_SMTP_USER"] == "u@example.test" and "OTHER_KEY" not in lw.os.environ
    assert not (tmp_path / "pwned").exists()
    for k in lw.SMTP_KEYS:
        monkeypatch.delenv(k, raising=False)
    assert lw.load_smtp_env(tmp_path / "missing.env") == []


def _post(i, modified, cats=(127,), title="قانون اصلاح ماده ۱۰ قانون مدنی"):
    return {"id": i, "date": "2999-01-01T00:00:00", "modified": modified, "link": f"https://www.ekhtebar.ir/{i}/",
            "title": {"rendered": title}, "excerpt": {"rendered": ""}, "categories": list(cats)}


def test_cursor_advances_to_last_processed_when_cap_hit(tmp_path, monkeypatch):
    monkeypatch.setattr(lw, "STATE_DIR", tmp_path)
    monkeypatch.setattr(lw, "PER_PAGE", 2)
    pages = {1: [_post(1, "2999-01-01T00:00:01"), _post(2, "2999-01-01T00:00:02")],
             2: [_post(3, "2999-01-01T00:00:03"), _post(4, "2999-01-01T00:00:04")], 3: [_post(5, "2999-01-01T00:00:05")]}
    urls = []

    def transport(url):
        urls.append(url)
        if "/posts/" in url:
            return json.dumps({"content": {"rendered": "<p>متن</p>"}}).encode(), {}
        pg = int(lw.re.search(r"[?&]page=(\d+)", url).group(1))
        return json.dumps(pages.get(pg, [])).encode(), {}

    f = lw.Fetcher(transport=transport, delay=0, sleep=lambda s: None)
    assert lw.cmd_poll(lw.argparse.Namespace(since_days=30, max_pages=1, no_text=True), f) == 0
    st = json.loads((tmp_path / "state.json").read_text())
    assert st["cursor_modified"] == "2999-01-01T00:00:02" and st["caught_up"] is False  # not past item 2
    # next run starts at cursor - 1 s and continues; nothing skipped, no duplicates
    urls.clear()
    f2 = lw.Fetcher(transport=transport, delay=0, sleep=lambda s: None)
    assert lw.cmd_poll(lw.argparse.Namespace(since_days=None, max_pages=10, no_text=True), f2) == 0
    assert "modified_after=2999-01-01T00%3A00%3A01" in urls[0]
    ids = sorted(i["post_id"] for i in lw.read_jsonl(tmp_path / "items.jsonl"))
    assert ids == [1, 2, 3, 4, 5]
    st = json.loads((tmp_path / "state.json").read_text())
    assert st["caught_up"] is True and st["cursor_modified"] == "2999-01-01T00:00:05"


def test_body_failure_defers_classification_and_retries(tmp_path, monkeypatch):
    monkeypatch.setattr(lw, "STATE_DIR", tmp_path)
    fail = {"on": True}

    def transport(url):
        if "/posts/7?" in url:
            if fail["on"]:
                raise OSError("boom")
            return json.dumps({"content": {"rendered": "<p>ماده ۱۰ اصلاح شد</p>"}}).encode(), {}
        return json.dumps([_post(7, "2999-01-01T00:00:01")] if "page=1" in url else []).encode(), {}

    f = lw.Fetcher(transport=transport, delay=0, sleep=lambda s: None)
    args = lw.argparse.Namespace(since_days=30, max_pages=3, no_text=False)
    assert lw.cmd_poll(args, f) == 0
    it = lw.read_jsonl(tmp_path / "items.jsonl")[0]
    assert it["needs_body_retry"] is True
    lw.cmd_classify(lw.argparse.Namespace(llm=False))
    assert lw.read_jsonl(tmp_path / "changes.jsonl") == []  # nothing produced from a missing body
    fail["on"] = False
    f2 = lw.Fetcher(transport=transport, delay=0, sleep=lambda s: None)
    assert lw.cmd_poll(lw.argparse.Namespace(since_days=None, max_pages=3, no_text=False), f2) == 0
    it = lw.read_jsonl(tmp_path / "items.jsonl")[0]
    assert it["needs_body_retry"] is False and it["text"].startswith("ماده")
    lw.cmd_classify(lw.argparse.Namespace(llm=False))
    rec = lw.read_jsonl(tmp_path / "changes.jsonl")[0]
    assert rec["change_type"] == "amendment" and rec["text"] and rec["text_sha256"]


def test_text_and_sha_travel_together_and_llm_upgrade_needs_body(tmp_path, monkeypatch):
    news = lw.classify_item(item("خبر", [539], text="x") | {"text_sha256": "abc"}, LAWS)
    assert news["text"] == "" and news["text_sha256"] is None
    monkeypatch.setattr(lw, "STATE_DIR", tmp_path)
    monkeypatch.setattr(lw, "pick_llm_model", lambda: ("deepseek/deepseek-v4.1-flash", 0.3, 1.2))
    post = lambda b, k: {"choices": [{"message": {"content": '{"change_type": "repeal", "law_name": null, "articles": []}'}}]}  # noqa: E731
    it = item("اصلاح مقررات سازمان", [127])  # no body
    out = lw.llm_classify(lw.classify_item(it, LAWS), it, http_post=post)
    assert out["needs_review"] is True and out["proposed_actions"] == [] and out["text_sha256"] is None
