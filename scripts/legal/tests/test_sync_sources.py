"""Offline tests for scripts/legal/sync_sources.py (synthetic fixtures, no network, no sleeping)."""
# ruff: noqa: RUF001
import argparse
import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
FX = Path(__file__).parent / "fixtures" / "sync_sources"
spec = importlib.util.spec_from_file_location("sync_sources", ROOT / "scripts" / "legal" / "sync_sources.py")
ss = importlib.util.module_from_spec(spec)
sys.modules["sync_sources"] = ss
spec.loader.exec_module(ss)

LAW = "https://nezamat.ir/post-1001/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%A2%D8%B2%D9%85%D8%A7%DB%8C%D8%B4%DB%8C/"
LAW2 = (
    "https://nezamat.ir/post-1002/%D8%A2%DB%8C%DB%8C%D9%86-%D9%86%D8%A7%D9%85%D9%87-"
    "%D8%A7%D8%AC%D8%B1%D8%A7%DB%8C%DB%8C-%D8%A2%D8%B2%D9%85%D8%A7%DB%8C%D8%B4%DB%8C/"
)

# real ekhtebar.ir law-page permalink shapes (percent-encoded Persian slug, one with an Arabic yeh)
EKHTEBAR_LAW = "https://www.ekhtebar.ir/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%A2%D8%B2%D9%85%D8%A7%DB%8C%D8%B4%DB%8C/"
EKHTEBAR_AYIN = "https://www.ekhtebar.ir/%D8%A2%D9%8A%D9%8A%D9%86-%D9%86%D8%A7%D9%85%D9%87-%D8%A2%D8%B2%D9%85%D8%A7%DB%8C%D8%B4%DB%8C/"
EKHTEBAR_QAVANIN = "https://www.ekhtebar.ir/%D9%82%D9%88%D8%A7%D9%86%DB%8C%D9%86-%D8%A2%D8%B2%D9%85%D8%A7%DB%8C%D8%B4%DB%8C/"
EKHTEBAR_NEWS = "https://www.ekhtebar.ir/%D8%A7%D8%AE%D8%A8%D8%A7%D8%B1-%D8%A2%D8%B2%D9%85%D8%A7%DB%8C%D8%B4%DB%8C/"
EKHTEBAR_FOREIGN = "http://www.ekhtebar.com/%D9%82%D8%A7%D9%86%D9%88%D9%86-x/"


def fx(name: str) -> bytes:
    return (FX / name).read_bytes()


class FakeNet:
    """opener(url, headers) -> (status, headers, body); records calls."""

    def __init__(self, routes):
        self.routes, self.calls = dict(routes), []

    def __call__(self, url, headers):
        self.calls.append((url, dict(headers)))
        return self.routes.get(url, (404, {}, b"not found"))


class Clock:
    def __init__(self):
        self.t, self.slept = 1000.0, []

    def now(self):
        return self.t

    def sleep(self, s):
        self.slept.append(s)
        self.t += s


def make_fetcher(cache_dir, routes, **kw):
    net, clk = FakeNet(routes), Clock()
    f = ss.Fetcher(Path(cache_dir) / "cache", opener=net, sleep=clk.sleep, clock=clk.now, **kw)
    return f, net, clk


ROUTES = {
    "https://nezamat.ir/robots.txt": (200, {}, fx("robots.txt")),
    "https://nezamat.ir/wp-sitemap.xml": (200, {}, fx("sitemap_index.xml")),
    "https://nezamat.ir/wp-sitemap-posts-post-1.xml": (200, {}, fx("sitemap_posts.xml")),
    LAW: (200, {"ETag": '"v1"'}, fx("law_page_nezamat.html")),
    LAW2: (404, {}, b""),
}

EKHTEBAR_ROUTES = {
    "https://www.ekhtebar.ir/robots.txt": (200, {}, fx("ekhtebar_robots.txt")),
    "https://www.ekhtebar.ir/sitemap_index.xml": (200, {}, fx("ekhtebar_sitemap_index.xml")),
    "https://www.ekhtebar.ir/post-sitemap.xml": (200, {}, fx("ekhtebar_post_sitemap.xml")),
}


# ---------------------------------------------------------------- fetcher
def test_rate_limit_user_agent_and_cache(tmp_path):
    f, net, clk = make_fetcher(tmp_path, ROUTES)
    s, _, body, cached = f.get(LAW)
    assert s == 200 and not cached and b"entry-content" in body
    assert all(h["User-Agent"] == "RoxiraBot/1.0 (+https://ghazihoushmand.ir)" for _, h in net.calls)
    f.get("https://nezamat.ir/wp-sitemap.xml")
    assert sum(clk.slept) >= 3.0 * 2  # robots, page, sitemap: three requests, >= 3 s apart
    net.routes[LAW] = (304, {}, b"")
    s, _, body2, cached = f.get(LAW)
    assert cached and body2 == body
    assert net.calls[-1][1]["If-None-Match"] == '"v1"'


def test_robots_disallow_is_obeyed(tmp_path):
    f, net, _ = make_fetcher(tmp_path, ROUTES)
    with pytest.raises(ss.FetchFailed):
        f.get("https://nezamat.ir/private/secret/")
    assert not any(u.endswith("/private/secret/") for u, _ in net.calls)


def test_unreadable_robots_means_disallow(tmp_path):
    routes = {**ROUTES, "https://nezamat.ir/robots.txt": (503, {}, b"")}
    f, _, _ = make_fetcher(tmp_path, routes, retries=1)
    with pytest.raises(ss.Blocked):
        f.get(LAW)


def test_challenge_page_hard_stops_host_and_is_never_retried(tmp_path):
    routes = {**ROUTES, LAW: (200, {}, fx("challenge_arvan.html"))}
    f, net, _ = make_fetcher(tmp_path, routes)
    with pytest.raises(ss.Blocked):
        f.get(LAW)
    assert "nezamat" in f.blocked
    n = len(net.calls)
    with pytest.raises(ss.Blocked):  # host skipped from now on: no more requests
        f.get("https://nezamat.ir/wp-sitemap.xml")
    assert len(net.calls) == n


def test_403_blocks_host(tmp_path):
    f, _, _ = make_fetcher(tmp_path, {**ROUTES, LAW: (403, {"Server": "ArvanCloud"}, b"denied")})
    with pytest.raises(ss.Blocked):
        f.get(LAW)
    assert "nezamat" in f.blocked


def test_backoff_on_5xx_then_success(tmp_path):
    f, net, clk = make_fetcher(tmp_path, ROUTES)
    seq = iter([(503, {}, b"x"), (500, {}, b"x"), (200, {}, fx("law_page_nezamat.html"))])
    orig = net.__call__

    def opener(url, headers):
        return next(seq) if url == LAW else orig(url, headers)

    f._opener = opener
    s, _, _, _ = f.get(LAW)
    assert s == 200
    assert max(clk.slept) >= 5  # exponential backoff between attempts


def test_redirect_to_foreign_host_is_refused(tmp_path):
    routes = {"https://ekhtebar.ir/robots.txt": (404, {}, b""),
              "https://ekhtebar.ir/a/": (301, {"Location": "https://evil.example/a/"}, b"")}  # fmt: skip
    f, _, _ = make_fetcher(tmp_path, routes)
    with pytest.raises(ss.Blocked):
        f.get("https://ekhtebar.ir/a/")


def test_ekhtebar_301_to_www(tmp_path):
    routes = {"https://ekhtebar.ir/robots.txt": (404, {}, b""), "https://www.ekhtebar.ir/robots.txt": (404, {}, b""),
              "https://ekhtebar.ir/x/": (301, {"Location": "https://www.ekhtebar.ir/x/"}, b""),
              "https://www.ekhtebar.ir/x/": (200, {}, b"<html><body>ok</body></html>")}  # fmt: skip
    f, _, _ = make_fetcher(tmp_path, routes)
    s, _, body, _ = f.get("https://ekhtebar.ir/x/")
    assert s == 200 and b"ok" in body


def test_detect_challenge_ignores_normal_pages():
    assert ss.detect_challenge(200, {}, fx("law_page_nezamat.html")) is None  # "captcha" only in a script string
    assert ss.detect_challenge(200, {}, fx("challenge_arvan.html"))
    assert ss.detect_challenge(200, {"cf-mitigated": "challenge"}, b"x")
    assert ss.detect_challenge(200, {}, b"<html>please solve the captcha</html>")


# ---------------------------------------------------------------- discovery
def test_parse_sitemap_index_and_urls():
    kids, urls = ss.parse_sitemap(fx("sitemap_index.xml"))
    assert len(kids) == 2 and not urls
    kids, urls = ss.parse_sitemap(fx("sitemap_posts.xml"))
    assert not kids and len(urls) == 5


def test_is_law_url():
    assert ss.is_law_url(LAW)
    assert not ss.is_law_url("https://nezamat.ir/post-1003/news-about-something/")
    assert not ss.is_law_url("https://nezamat.ir/category/%D9%82%D8%A7%D9%86%D9%88%D9%86/")


def test_discover_filters_sorts_and_skips_taxonomy_sitemaps(tmp_path):
    f, net, _ = make_fetcher(tmp_path, ROUTES)
    items = ss.discover(f, "nezamat")
    assert items[0]["url"] == LAW  # newest lastmod first
    assert len(items) == 2
    assert not any("taxonomies" in u for u, _ in net.calls)
    assert len(ss.discover(f, "nezamat", max_urls=1)) == 1


def test_is_law_url_matches_ekhtebar_slugs():
    _kids, urls = ss.parse_sitemap(fx("ekhtebar_post_sitemap.xml"))
    matched = set()
    for loc, _lm in urls:
        try:
            if ss.host_key(loc) == "ekhtebar" and ss.is_law_url(loc):
                matched.add(loc)
        except ss.Blocked:
            continue
    assert {EKHTEBAR_LAW, EKHTEBAR_AYIN, EKHTEBAR_QAVANIN} <= matched
    assert EKHTEBAR_NEWS not in matched and EKHTEBAR_FOREIGN not in matched


def test_ekhtebar_discovery_uses_well_known_yoast_sitemap(tmp_path):
    f, net, _ = make_fetcher(tmp_path, EKHTEBAR_ROUTES)
    items = ss.discover(f, "ekhtebar")
    urls = [it["url"] for it in items]
    assert urls[0] == EKHTEBAR_LAW  # newest lastmod first
    assert {EKHTEBAR_LAW, EKHTEBAR_AYIN, EKHTEBAR_QAVANIN} <= set(urls)
    assert EKHTEBAR_NEWS not in urls and EKHTEBAR_FOREIGN not in urls
    called = {u for u, _ in net.calls}
    # the robots.txt Sitemap line points at another domain: it is ignored, the well-known path is used
    assert "https://www.ekhtebar.ir/sitemap_index.xml" in called
    assert not any(u.startswith("http://www.ekhtebar.com") for u in called)


# ---------------------------------------------------------------- parsing
def test_parse_law_page():
    p = ss.parse_law_page("nezamat", LAW, fx("law_page_nezamat.html").decode())
    assert p["title"] == "قانون آزمایشی نمونه"
    assert p["meta"]["approval_date"] == "1395-02-20"
    assert p["meta"]["authority"] == "مجلس شورای اسلامی"
    assert p["meta"]["number"] == "1234"
    assert [r["article_label"] for r in p["rows"]] == ["ماده 1", "ماده 2", "ماده 3"]
    r0 = p["rows"][0]
    assert "ي" not in r0["text"] and "ك" not in r0["text"]
    assert r0["source_url"] == LAW and r0["source"] == "nezamat" and r0["needs_review"] is True
    assert r0["approval_date"] == "1395-02-20" and r0["is_active"] and r0["status"] == "VALID"
    assert "پانوشت" not in json.dumps(p["rows"], ensure_ascii=False)
    assert p["law_id"] == "sync_nezamat_1001"


def test_repealed_page_goes_to_repealed_rows():
    p = ss.parse_law_page("nezamat", "https://nezamat.ir/post-5/x/", fx("law_page_repealed.html").decode())
    assert p["meta"]["page_status"] == "repealed"
    assert not p["rows"] and len(p["repealed_rows"]) == 2
    assert all(r["status"] == "REPEALED" and not r["is_active"] for r in p["repealed_rows"])


# ---------------------------------------------------------------- cross-check
def corpus_file(tmp_path, art2):
    name = "قانون آزمایشی نمونه"
    items = ((1, "این قانون برای آزمایش است ک و ی عربی.\nتبصره- استثنا وجود دارد."), (2, art2), (9, "ماده نهم فقط در پیکره است."))
    rows = [{"law_id": "old", "law_name": name, "article_label": f"ماده {i}", "article_no": str(i),
             "source": "qavanin", "is_active": True, "text": f"ماده {i} {name}: {t}"} for i, t in items]  # fmt: skip
    p = tmp_path / "corpus.jsonl"
    p.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows), encoding="utf-8")
    return p


DIFFERENT = "متن کاملا متفاوت و قدیمی درباره موضوعی دیگر که عوض شده است."


def test_cross_check_reports_differences(tmp_path):
    idx = ss.load_corpus_index([str(corpus_file(tmp_path, DIFFERENT))])
    parsed = ss.parse_law_page("nezamat", LAW, fx("law_page_nezamat.html").decode())
    d = ss.cross_check(parsed, idx)
    found = {(x["article_label"], x["result"]) for x in d}
    assert ("ماده 2", "text_differs") in found
    assert ("ماده 3", "article_missing_in_corpus") in found
    assert ("ماده 9", "article_missing_in_source") in found
    assert not any(x["article_label"] == "ماده 1" for x in d)  # identical after normalisation
    assert ss.cross_check({**parsed, "title": "قانون ناشناخته"}, idx) is None


# ---------------------------------------------------------------- end to end
def args_for(tmp_path, corpus, **kw):
    ns = dict(host="nezamat", dry_run=False, limit=None, full=False, delay=3.0, max_requests=100,
              state_dir=tmp_path / "state", out_dir=tmp_path / "staged", report_dir=tmp_path / "docs",
              corpus_glob=[str(corpus)], tag="")  # fmt: skip
    ns.update(kw)
    return argparse.Namespace(**ns)


def test_dry_run_makes_no_page_requests_and_writes_nothing(tmp_path, capsys):
    f, net, _ = make_fetcher(tmp_path, ROUTES)
    a = args_for(tmp_path, tmp_path / "none.jsonl", dry_run=True, limit=1)
    assert ss.run_sync(a, f, "2026-10-20") == 0
    assert LAW not in [u for u, _ in net.calls]
    assert not (tmp_path / "staged").exists()
    assert not (tmp_path / "state" / "state.json").exists()
    assert "post-1001" in capsys.readouterr().out


def test_full_run_stages_new_law_then_incremental_skips(tmp_path):
    empty = tmp_path / "empty.jsonl"
    empty.write_text("", encoding="utf-8")
    f, _, _ = make_fetcher(tmp_path / "c1", ROUTES)
    assert ss.run_sync(args_for(tmp_path, empty), f, "2026-10-20") == 0
    out = tmp_path / "staged" / "sync_sources_2026-10-20_nezamat.jsonl"
    rows = [json.loads(x) for x in out.read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 3 and rows[0]["law_name"] == "قانون آزمایشی نمونه"
    report = (tmp_path / "docs" / "SYNC_REPORT_2026-10-20.md").read_text(encoding="utf-8")
    assert "قانون آزمایشی نمونه" in report and "| new_laws | 1 |" in report
    state = json.loads((tmp_path / "state" / "state.json").read_text(encoding="utf-8"))
    assert state["urls"][LAW]["lastmod"] == "2026-10-05T08:00:00+00:00"
    f2, net2, _ = make_fetcher(tmp_path / "c2", ROUTES)
    ss.run_sync(args_for(tmp_path, empty, tag="b"), f2, "2026-10-20")
    assert LAW not in [u for u, _ in net2.calls]  # same lastmod => not fetched again


def test_existing_law_goes_to_review_file_not_staged(tmp_path):
    corpus = corpus_file(tmp_path, DIFFERENT)
    f, _, _ = make_fetcher(tmp_path, ROUTES)
    ss.run_sync(args_for(tmp_path, corpus), f, "2026-10-20")
    staged = tmp_path / "staged"
    assert not (staged / "sync_sources_2026-10-20_nezamat.jsonl").exists()
    lines = (staged / "sync_sources_2026-10-20_review.jsonl").read_text(encoding="utf-8").splitlines()
    assert any(json.loads(x)["result"] == "text_differs" for x in lines)


def test_challenge_during_run_skips_host_and_exit_code(tmp_path):
    empty = tmp_path / "empty.jsonl"
    empty.write_text("", encoding="utf-8")
    f, _, _ = make_fetcher(tmp_path, {**ROUTES, LAW: (200, {}, fx("challenge_arvan.html"))})
    assert ss.run_sync(args_for(tmp_path, empty), f, "2026-10-20") == 6
    report = (tmp_path / "docs" / "SYNC_REPORT_2026-10-20.md").read_text(encoding="utf-8")
    assert "challenge" in report


def test_never_overwrites_existing_output(tmp_path):
    p = tmp_path / "x.jsonl"
    p.write_text("keep", encoding="utf-8")
    with pytest.raises(SystemExit):
        ss.write_new_jsonl(p, [{"a": 1}])
    assert p.read_text() == "keep"


def test_budget_exhaustion_is_deferred_not_failed(tmp_path):
    empty = tmp_path / "empty.jsonl"
    empty.write_text("", encoding="utf-8")
    # discovery needs 5 requests (robots + 3 well-known sitemaps + post sitemap): only law 1 is fetched
    f, _, _ = make_fetcher(tmp_path / "c", ROUTES, max_requests=6)
    assert ss.run_sync(args_for(tmp_path, empty, max_requests=6), f, "2026-10-20") == 0
    report = (tmp_path / "docs" / "SYNC_REPORT_2026-10-20.md").read_text(encoding="utf-8")
    assert "| pages_failed | 0 |" in report
    assert "| pages_deferred_budget | 1 |" in report
    assert "continues on the next run" in report
