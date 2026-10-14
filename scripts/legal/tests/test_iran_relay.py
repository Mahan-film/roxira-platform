"""Offline tests for scripts/legal/iran_relay.py (fixtures only, monkeypatched fetch, no network)."""
# ruff: noqa: RUF001
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FIX = Path(__file__).resolve().parent / "fixtures" / "iran_relay"
spec = importlib.util.spec_from_file_location("iran_relay", ROOT / "scripts" / "legal" / "iran_relay.py")
ir = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ir)

ROW_KEYS = [
    "source", "source_tier", "url", "doc_id", "title", "doc_type", "number", "date", "issuer",
    "text", "fetched_at", "staging_status", "needs_review",
]


def read(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8")


# --------------------------------------------------------------------------- list parsing
def test_taxreg_list_finds_document_links():
    items = ir.parse_taxreg_list(read("taxreg_list_last_nz.html"))
    ids = {i["doc_id"] for i in items}
    assert "taxreg:txs5000102292" in ids
    assert all(i["url"].startswith("https://regulation.tax.gov.ir/lwvi?lid=") for i in items)
    first = next(i for i in items if i["doc_id"] == "taxreg:txs5000102292")
    assert "تبصره" in first["title"]
    assert first["number"] == "7/1403/667"
    assert first["issuer"] == "اداره حقوقی قوه قضائیه"
    # a second act (آرا) parses too, with its ty=ry links
    ry = ir.parse_taxreg_list(read("taxreg_list_last_ry.html"))
    assert any(i["url"].endswith("&ty=ry") for i in ry)


def test_rcmajlis_index_finds_law_links():
    items = ir.parse_rcmajlis_index(read("rcmajlis_law_index.html"))
    by_id = {i["id"]: i for i in items}
    assert "1860542" in by_id
    assert "شورای عالی اداری" in by_id["1860542"]["title"]


def test_dotic_sitemap_filters_rule_pages():
    locs = ir.parse_sitemap(read("dotic_sitemap_page1.xml"))
    assert len(locs) > 10
    matching = [u for u in locs if ir.dotic_matches(ir.dotic_title_from_url(u))]
    assert any("21635" in u for u in matching)
    # a plain piece of news ("مجموعه تنقیحی قانون...") matches on قانون, while a non-rule slug does not
    assert ir.dotic_matches(ir.dotic_title_from_url("https://dotic.ir/news/21635/بخشنامه-موضوع-خرید"))
    assert not ir.dotic_matches(ir.dotic_title_from_url("https://dotic.ir/news/1/معرفی-کتاب-جدید"))


# --------------------------------------------------------------------------- document parsing
def test_taxreg_document_extracts_title_text_and_meta():
    row = ir.parse_taxreg_doc(read("taxreg_view_qh.html"), "https://regulation.tax.gov.ir/lwvi?lid=txs5000112488&ty=qh")
    assert row["source"] == "taxreg" and row["source_tier"] == "official"
    assert row["title"] == "قانون مالیات بر سوداگری و سفته بازی"
    assert row["doc_type"] == "law"
    assert row["date"] == "1404/04/08"
    assert row["issuer"] == "مجلس شورای اسلامی"
    assert "ماده" in row["text"] and len(row["text"]) > 50


def test_dotic_news_extracts_title_text_and_meta():
    url = "https://dotic.ir/news/21635/بخشنامه-موضوع-اضافه-نمودن-تعرفه-های-مجاز"
    row = ir.parse_dotic_news(read("dotic_news_circular.html"), url)
    assert row["doc_id"] == "dotic:21635"
    assert row["doc_type"] == "circular"
    assert "بخشنامه" in row["title"]
    assert row["issuer"] == "سازمان توسعه تجارت ایران"
    assert row["number"] == "8938629"
    assert row["date"] == "1405/07/21"
    assert "تعرفه" in row["text"]


def test_rcmajlis_document_extracts_title_text_and_meta():
    url = "https://rc.majlis.ir/fa/law/show/1860542"
    row = ir.parse_rcmajlis_doc(read("rcmajlis_law_show.html"), url)
    assert row["source"] == "rcmajlis" and row["doc_id"] == "rcmajlis:1860542"
    assert row["doc_type"] == "bylaw"
    assert "شورای عالی اداری" in row["title"]
    assert row["date"] == "1405/10/26"
    assert row["issuer"] == "مصوبات هیات وزیران"
    assert "شورای عالی اداری" in row["text"]


# --------------------------------------------------------------------------- challenges
def test_challenge_detection_and_content_not_flagged():
    assert ir.is_challenge("<html><body>Transferring to the website ...</body></html>")
    assert ir.is_challenge(b"<html><title>Just a moment...</title></html>")
    assert ir.is_challenge("<html><img src='/captcha.png'></html>")  # near-empty shell
    # the real dotic page mentions captcha in its comment form but is not a challenge
    assert not ir.is_challenge(read("dotic_news_circular.html"))


# --------------------------------------------------------------------------- run / state / schema
def _fake_fetch_factory():
    pages = {
        "sitemap.php?page=1": read("dotic_sitemap_page1.xml"),
        "lws3?act=": read("taxreg_list_last_nz.html"),
        "lwvi?lid=": read("taxreg_view_qh.html"),
        "dotic.ir/news/": read("dotic_news_circular.html"),
        "rc.majlis.ir/fa/law/show/": read("rcmajlis_law_show.html"),
    }
    calls = []

    def fake_fetch(url, timeout=None):
        calls.append(url)
        if "sitemap.php?page=" in url and "page=1" not in url:
            return 200, b'<?xml version="1.0"?><urlset></urlset>'
        for needle, content in pages.items():
            if needle in url:
                return 200, content.encode("utf-8")
        return 404, b""

    return fake_fetch, calls


def _run_env(tmp_path, monkeypatch):
    monkeypatch.setattr(ir, "STATE_DIR", tmp_path / "state")
    monkeypatch.setattr(ir, "STAGED_DIR", tmp_path / "staged")
    monkeypatch.setattr(ir, "MIN_DELAY", 0.0)
    monkeypatch.setattr(ir, "_sleep", lambda seconds: None)
    cfg = tmp_path / "iran_relay.json"
    cfg.write_text(json.dumps({"rc_law_ids": ["1860542"]}), encoding="utf-8")
    monkeypatch.setattr(ir, "CONFIG", cfg)
    fake_fetch, calls = _fake_fetch_factory()
    monkeypatch.setattr(ir, "fetch_url", fake_fetch)
    return calls


def test_run_writes_rows_and_state_prevents_refetch(tmp_path, monkeypatch):
    _run_env(tmp_path, monkeypatch)
    args = ir.argparse.Namespace(max_per_source=2)
    assert ir.cmd_run(args) == 0

    files = sorted((tmp_path / "staged").glob("iran_relay_*.jsonl"))
    assert len(files) == 1
    rows = [json.loads(line) for line in files[0].read_text(encoding="utf-8").splitlines()]
    assert {r["source"] for r in rows} == {"taxreg", "dotic", "rcmajlis"}
    for r in rows:
        assert list(r.keys()) == ROW_KEYS
        assert r["source_tier"] == "official"
        assert r["staging_status"] == "proposed"
        assert r["needs_review"] is True
        assert r["fetched_at"] and r["text"] and r["title"]

    state = json.loads((tmp_path / "state" / "state.json").read_text(encoding="utf-8"))
    assert set(state["seen"]) == {"taxreg", "dotic", "rcmajlis"}
    assert state["seen"]["rcmajlis"] == ["rcmajlis:1860542"]

    # a second run never re-fetches a document already written (the per-run cap of 40 may leave
    # more list links for later runs, so new rows are allowed, duplicates are not)
    before = files[0].read_text(encoding="utf-8")
    first_ids = [json.loads(line)["doc_id"] for line in before.splitlines()]
    assert ir.cmd_run(args) == 0
    after = files[0].read_text(encoding="utf-8")
    assert after.startswith(before)
    all_ids = [json.loads(line)["doc_id"] for line in after.splitlines()]
    assert len(all_ids) == len(set(all_ids)), "a document was fetched twice"
    assert set(first_ids) <= set(all_ids)
    assert len(list((tmp_path / "staged").glob("*.jsonl"))) == 1


def test_unreachable_sources_exit_zero(tmp_path, monkeypatch):
    monkeypatch.setattr(ir, "STATE_DIR", tmp_path / "state")
    monkeypatch.setattr(ir, "STAGED_DIR", tmp_path / "staged")
    monkeypatch.setattr(ir, "MIN_DELAY", 0.0)
    monkeypatch.setattr(ir, "_sleep", lambda seconds: None)
    monkeypatch.setattr(ir, "fetch_url", lambda url, timeout=None: (_ for _ in ()).throw(OSError("no route")))
    args = ir.argparse.Namespace(max_per_source=2)
    assert ir.cmd_run(args) == 0
    assert not list((tmp_path / "staged").glob("*.jsonl"))


def test_challenged_source_is_skipped(tmp_path, monkeypatch):
    _run_env(tmp_path, monkeypatch)

    def challenge_fetch(url, timeout=None):
        return 200, b"<html><body>Transferring to the website</body></html>"

    monkeypatch.setattr(ir, "fetch_url", challenge_fetch)
    args = ir.argparse.Namespace(max_per_source=2)
    assert ir.cmd_run(args) == 0
    assert not list((tmp_path / "staged").glob("*.jsonl"))


def test_iri_to_uri_encodes_persian_slug():
    url = "http://dotic.ir/news/21589/پیش-نویس-بخشنامه?x=۱"
    out = ir._iri_to_uri(url)
    assert out.isascii() and out.startswith("http://dotic.ir/news/21589/%D9%BE")
    assert ir._iri_to_uri("https://rc.majlis.ir/fa/law/show/1860542") == "https://rc.majlis.ir/fa/law/show/1860542"
