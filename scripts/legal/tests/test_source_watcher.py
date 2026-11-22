"""Offline tests for scripts/legal/source_watcher.py (no network, no sleeping)."""
# ruff: noqa: E501

import gzip
import importlib.util
import json
import sqlite3
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "source_watcher", Path(__file__).resolve().parents[1] / "source_watcher.py"
)
sw = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sw)

CHALLENGE = b'<html><body><link href="/cdn-cgi/assets/css/x.css"><h2>Transferring to the website...</h2></body></html>'
WAF = "<html><body><div>درخواست رد شد</div><div class='support-id'>123</div></body></html>".encode()
PARKED = b"<p>&nbsp;</p><h1>This domain name may be for sale</h1>"
PAGE = (
    "<html><head><title>صفحه اصلی</title></head><body>"
    + "".join(f'<a href="/n/{i}">بخشنامه {i}</a>' for i in range(5))
    + "<a href='#x'>x</a><a href='http://other.test/a'>o</a></body></html>"
).encode()


def test_classify_200_is_not_content():
    assert sw.classify_page(200, {}, CHALLENGE) == sw.CHALLENGE
    assert sw.classify_page(200, {}, WAF) == sw.BLOCKED
    assert sw.classify_page(200, {}, PARKED) == sw.PARKED
    assert sw.classify_page(200, {}, PAGE) == sw.OK
    assert sw.classify_page(200, {}, b"") == sw.EMPTY
    assert sw.classify_page(403, {}, b"nope") == sw.BLOCKED
    assert sw.classify_page(403, {}, CHALLENGE) == sw.CHALLENGE
    assert sw.classify_page(302, {"Location": "/Account/Login?x=1"}, b"") == sw.LOGIN
    assert sw.classify_page(302, {"Location": "/fa/"}, b"") == sw.REDIRECT
    assert sw.classify_page(404, {}, b"missing") == sw.HTTP_ERROR


def test_big_page_with_captcha_word_is_still_ok():
    big = b"<html><body>" + b"x " * 20000 + b"<form>g-recaptcha</form></body></html>"
    assert sw.classify_page(200, {}, big) == sw.OK


def test_normalize_text():
    assert sw.normalize_text("كتاب ي ۱۲۳ ٤٥  \n x") == "کتاب ی 123 45 x"
    assert sw.sha256_text("ي") == sw.sha256_text("ی")


def test_extract_links_same_host_filter_and_fragments():
    p = sw.extract_page(PAGE, "https://a.test/")
    urls = [lk["url"] for lk in p["links"]]
    assert "https://a.test/n/0" in urls and all("#" not in u for u in urls)
    assert p["title"] == "صفحه اصلی"


def _opener(pages):
    calls = []

    def op(url, headers, ca):
        calls.append(url)
        assert headers["User-Agent"].startswith("RoxiraBot/1.0")
        return pages.get(url, (404, {}, b"nf"))

    op.calls = calls
    return op


def _src(**k):
    return {
        "id": "t",
        "list_urls": ["https://a.test/"],
        "tier": "official",
        "doc_type": "circular",
        **k,
    }


def _client(opener, **k):
    return sw.Client(opener=opener, sleep=lambda s: None, **k)


def test_run_source_missing_robots_is_ok_and_items_new(tmp_path):
    con = sw.open_state(tmp_path / "s.db")
    op = _opener({"https://a.test/": (200, {}, PAGE)})
    rep = sw.run_source(_src(), _client(op), con)
    assert (
        rep["host_state"] == sw.OK
        and len(rep["items"]) == 5
        and {i["state"] for i in rep["items"]} == {"new"}
    )
    assert op.calls[0] == "https://a.test/robots.txt"


def test_robots_disallow_respected():
    con = sqlite3.connect(":memory:")
    con.executescript(sw.SCHEMA)
    op = _opener(
        {
            "https://a.test/robots.txt": (200, {}, b"User-agent: *\nDisallow: /\n"),
            "https://a.test/": (200, {}, PAGE),
        }
    )
    rep = sw.run_source(_src(), _client(op), con)
    assert (
        rep["pages"] == []
        and any("robots" in n for n in rep["notes"])
        and "https://a.test/" not in op.calls
    )


def test_challenge_robots_stops_host_nothing_parsed():
    con = sqlite3.connect(":memory:")
    con.executescript(sw.SCHEMA)
    op = _opener(
        {"https://a.test/robots.txt": (200, {}, CHALLENGE), "https://a.test/": (200, {}, PAGE)}
    )
    rep = sw.run_source(_src(), _client(op), con)
    assert rep["host_state"] != sw.OK and rep["items"] == [] and "https://a.test/" not in op.calls


def test_waf_page_on_list_stops_and_parses_nothing():
    con = sqlite3.connect(":memory:")
    con.executescript(sw.SCHEMA)
    op = _opener({"https://a.test/": (200, {}, WAF)})
    rep = sw.run_source(_src(), _client(op), con)
    assert rep["host_state"] == sw.BLOCKED and rep["items"] == []


def test_change_detection_new_changed_same(tmp_path):
    con = sw.open_state(tmp_path / "s.db")
    items = [{"url": "https://a.test/x", "title": "t", "content_sha256": "1"}]
    sw.save_items(con, "t", sw.diff_items(con, "t", items), "now")
    assert sw.diff_items(con, "t", items)[0]["state"] == "same"
    items[0]["content_sha256"] = "2"
    assert sw.diff_items(con, "t", items)[0]["state"] == "changed"


def test_budget_and_delay():
    sleeps = []
    c = sw.Client(opener=_opener({}), max_requests=2, sleep=sleeps.append)
    c.fetch("https://a.test/1")
    c.fetch("https://a.test/2")
    assert sleeps and sleeps[0] > 2
    try:
        c.fetch("https://a.test/3")
        raise AssertionError("budget not enforced")
    except sw.Skip:
        pass


def test_gzip_body_and_tls_error():
    op = _opener({"https://a.test/": (200, {"Content-Encoding": "gzip"}, gzip.compress(PAGE))})
    state, *_ = _client(op).fetch("https://a.test/")
    assert state == sw.OK

    def tls(url, headers, ca):
        import ssl

        raise ssl.SSLCertVerificationError("bad")

    state, status, *_ = _client(tls).fetch("https://a.test/")
    assert state == sw.TLS_ERROR and status == 0


def test_dry_run_writes_no_state(tmp_path, monkeypatch):
    monkeypatch.setenv("SOURCE_WATCHER_STATE", str(tmp_path))
    cfg = tmp_path / "c.json"
    cfg.write_text(json.dumps({"sources": [_src()]}))
    real = sw.Client
    monkeypatch.setattr(
        sw,
        "Client",
        lambda **k: real(
            opener=_opener({"https://a.test/": (200, {}, PAGE)}), sleep=lambda s: None, **k
        ),
    )
    assert sw.main(["run", "--config", str(cfg)]) == 0
    con = sqlite3.connect(tmp_path / "state.db")
    assert (
        con.execute("SELECT COUNT(*) FROM items").fetchone()[0] == 0
        and not (tmp_path / "staged").exists()
    )
    assert sw.main(["run", "--config", str(cfg), "--commit"]) == 0
    assert con.execute("SELECT COUNT(*) FROM items").fetchone()[0] == 5
    rows = [
        json.loads(line)
        for f in (tmp_path / "staged").glob("*.jsonl")
        for line in f.read_text().splitlines()
    ]
    assert len(rows) == 5 and all(
        r["needs_review"] and r["staging_status"] == "proposed" for r in rows
    )


def test_config_requires_https(tmp_path):
    cfg = tmp_path / "c.json"
    cfg.write_text(json.dumps({"sources": [_src(list_urls=["http://a.test/"])]}))
    try:
        sw.load_config(cfg)
        raise AssertionError("http accepted")
    except SystemExit:
        pass


def test_same_site_redirect_followed_other_site_and_login_not():
    pages = {
        "https://a.test/": (301, {"Location": "https://www.a.test/fa/"}, b""),
        "https://www.a.test/fa/": (200, {}, PAGE),
        "https://b.test/": (302, {"Location": "https://evil.test/"}, b""),
        "https://c.test/": (302, {"Location": "/Account/Login"}, b""),
    }
    state, _s, _h, _b, final = _client(_opener(pages)).fetch("https://a.test/")
    assert state == sw.OK and final == "https://www.a.test/fa/"
    assert _client(_opener(pages)).fetch("https://b.test/")[0] == sw.REDIRECT
    assert _client(_opener(pages)).fetch("https://c.test/")[0] == sw.LOGIN


def test_empty_robots_file_is_ok():
    con = sqlite3.connect(":memory:")
    con.executescript(sw.SCHEMA)
    op = _opener({"https://a.test/robots.txt": (200, {}, b""), "https://a.test/": (200, {}, PAGE)})
    assert sw.run_source(_src(), _client(op), con)["host_state"] == sw.OK
