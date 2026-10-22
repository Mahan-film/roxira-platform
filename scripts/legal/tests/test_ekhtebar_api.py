"""Offline tests for scripts/legal/ekhtebar_api.py (recorded JSON fixtures, no network, no real sleeping).

  python3 -m pytest scripts/legal/tests/test_ekhtebar_api.py -q
"""
import importlib.util
import json
import sys
import urllib.parse
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
FX = Path(__file__).parent / "fixtures" / "ekhtebar_api"
spec = importlib.util.spec_from_file_location("ekhtebar_api", ROOT / "scripts" / "legal" / "ekhtebar_api.py")
ea = importlib.util.module_from_spec(spec)
sys.modules["ekhtebar_api"] = ea
spec.loader.exec_module(ea)

BASE = "https://www.ekhtebar.com"
TAG_SLUG = "بخشنامه-بانک-مرکزی"
POSTS_PATH = "/wp-json/wp/v2/posts"
TAGS_PATH = "/wp-json/wp/v2/tags"


def fx(name: str) -> bytes:
    return (FX / name).read_bytes()


def qkey(query: str):
    return tuple(sorted((k, tuple(v)) for k, v in urllib.parse.parse_qs(query).items()))


def route_key(path: str, params: dict):
    return (path, tuple(sorted((k, (str(v),)) for k, v in params.items())))


def route(path: str, params: dict, body, status: int = 200, headers: dict | None = None):
    return route_key(path, params), (status, headers or {}, body)


def post_params(page: int, **extra):
    return {"per_page": 100, "page": page, "_fields": ea.POST_FIELDS, **extra}


class FakeNet:
    """opener(url, headers) -> (status, headers, body), matching on path + query params."""

    def __init__(self, routes):
        self.routes, self.calls = dict(routes), []

    def __call__(self, url, headers):
        self.calls.append((url, dict(headers)))
        u = urllib.parse.urlparse(url)
        for (path, key), resp in self.routes.items():
            if path == u.path and key == qkey(u.query):
                return resp
        return (404, {}, b"not found")


class Clock:
    def __init__(self):
        self.t, self.slept = 1000.0, []

    def now(self):
        return self.t

    def sleep(self, s):
        self.slept.append(s)
        self.t += s


def make_client(routes, **kw):
    net, clk = FakeNet(routes), Clock()
    c = ea.Client(opener=net, sleep=clk.sleep, clock=clk.now, **kw)
    return c, net, clk


def base_routes(header_pages: str = "2"):
    return dict([
        route("/robots.txt", {}, fx("robots.txt")),
        route(TAGS_PATH, {"slug": TAG_SLUG, "per_page": 100, "_fields": ea.TAXONOMY_FIELDS}, fx("tags_search.json")),
        route(TAGS_PATH, {"search": TAG_SLUG, "per_page": 100, "_fields": ea.TAXONOMY_FIELDS}, b"[]"),
        route("/wp-json/wp/v2/categories",
              {"slug": "بخشنامه-ثبتی", "per_page": 100, "_fields": ea.TAXONOMY_FIELDS},
              fx("categories_search.json")),
        route(POSTS_PATH, post_params(1, tags=10), fx("posts_page1.json"),
              headers={"X-WP-TotalPages": header_pages}),
        route(POSTS_PATH, post_params(2, tags=10), fx("posts_page2.json"),
              headers={"X-WP-TotalPages": header_pages}),
        route(POSTS_PATH, post_params(1, categories=20), fx("posts_page1.json"),
              headers={"X-WP-TotalPages": "1"}),
        route(POSTS_PATH, post_params(1, search="بانک"), fx("posts_page1.json"),
              headers={"X-WP-TotalPages": "1"}),
    ])


# ---------------------------------------------------------------- client / politeness
def test_client_user_agent_delay_and_budget(tmp_path):
    c, net, clk = make_client(base_routes("1"))
    status, _, _ = c.get(ea.rest_url(BASE, POSTS_PATH, post_params(1, tags=10)))
    assert status == 200
    assert all(h["User-Agent"] == "RoxiraBot/1.0 (+https://ghazihoushmand.ir)" for _, h in net.calls)
    assert sum(clk.slept) >= 2.0  # robots then one page: one >= 2 s gap
    small, _, _ = make_client(base_routes("1"), max_requests=1)
    with pytest.raises(ea.BudgetExhausted):
        small.get(ea.rest_url(BASE, POSTS_PATH, post_params(1, tags=10)))


def test_backoff_on_5xx_then_success(tmp_path):
    target = ea.rest_url(BASE, POSTS_PATH, post_params(1, tags=10))
    c, net, clk = make_client({})
    seq = iter([(503, {}, b"x"), (500, {}, b"x"), (200, {"X-WP-TotalPages": "1"}, fx("posts_page1.json"))])
    orig = net.__call__

    def opener(url, headers):
        return next(seq) if url == target else orig(url, headers)

    c._opener = opener
    status, _, _ = c.get(target)
    assert status == 200
    assert max(clk.slept) >= 5  # exponential backoff between attempts


def test_challenge_page_hard_stops(tmp_path):
    routes = dict(base_routes("1"))
    routes.update([route(POSTS_PATH, post_params(1, tags=10), fx("challenge.html"))])
    c, _, _ = make_client(routes)
    assert ea.run_tag(c, BASE, TAG_SLUG, tmp_path, "2026-10-22") == 6
    report = (tmp_path / "ekhtebar_api_tag_2026-10-22.md").read_text(encoding="utf-8")
    assert "moment" in report.lower() or "challenge" in report.lower()


def test_robots_disallow_is_obeyed(tmp_path):
    routes = dict(base_routes("1"))
    routes.update([route("/robots.txt", {}, b"User-agent: *\nDisallow: /wp-json/\n")])
    c, _, _ = make_client(routes)
    assert c.allowed(ea.rest_url(BASE, POSTS_PATH)) is False


# ---------------------------------------------------------------- taxonomy lookups
def test_resolve_tag_slug_then_search():
    c, _, _ = make_client(base_routes("1"))
    tag = ea.resolve_tag(c, BASE, TAG_SLUG)
    assert tag == {"id": 10, "name": "بخشنامه بانک مرکزی", "slug": TAG_SLUG}
    fallback = dict([
        route(TAGS_PATH, {"slug": TAG_SLUG, "per_page": 100, "_fields": ea.TAXONOMY_FIELDS}, b"[]"),
        route(TAGS_PATH, {"search": TAG_SLUG, "per_page": 100, "_fields": ea.TAXONOMY_FIELDS},
              fx("tags_search.json")),
    ])
    c2, _, _ = make_client(fallback)
    assert ea.resolve_tag(c2, BASE, TAG_SLUG)["id"] == 10


def test_iter_posts_follows_total_pages():
    c, _, _ = make_client(base_routes("2"))
    posts = list(ea.iter_posts(c, BASE, {"tags": 10}))
    assert [p["id"] for p in posts] == [501, 502, 503]


# ---------------------------------------------------------------- row schema
def test_post_to_rows_reuses_sync_sources_schema():
    post = json.loads(fx("posts_page1.json"))[0]
    parsed = ea.post_to_rows(post, "2026-10-22T00:00:00+00:00")
    assert [r["article_label"] for r in parsed["rows"]] == ["ماده 1", "ماده 2"]
    r0 = parsed["rows"][0]
    assert r0["law_name"] == post["title"]["rendered"]
    assert r0["source"] == "ekhtebar" and r0["source_label"] == "ekhtebar.ir"
    assert r0["source_tier"] == "unofficial" and r0["needs_review"] is True
    assert r0["staging_status"] == "proposed"
    assert r0["source_url"] == post["link"]
    assert r0["retrieved_at"] == "2026-10-22T00:00:00+00:00"
    assert r0["modified"] == post["modified"]
    assert r0["law_id"] == "sync_ekhtebar_501"
    assert "ي" not in r0["text"] and "ك" not in r0["text"]


# ---------------------------------------------------------------- commands
def test_run_tag_writes_new_jsonl_and_report(tmp_path):
    c, _, _ = make_client(base_routes("2"))
    assert ea.run_tag(c, BASE, TAG_SLUG, tmp_path, "2026-10-22") == 0
    out = tmp_path / "ekhtebar_api_tag_2026-10-22.jsonl"
    rows = [json.loads(x) for x in out.read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 6  # three posts x two articles
    assert {r["law_id"] for r in rows} == {"sync_ekhtebar_501", "sync_ekhtebar_502", "sync_ekhtebar_503"}
    report = (tmp_path / "ekhtebar_api_tag_2026-10-22.md").read_text(encoding="utf-8")
    assert "posts fetched: 3" in report and "ekhtebar.ir" in report


def test_run_category_writes_rows(tmp_path):
    c, _, _ = make_client(base_routes("1"))
    assert ea.run_category(c, BASE, "بخشنامه-ثبتی", tmp_path, "2026-10-22") == 0
    out = tmp_path / "ekhtebar_api_category_2026-10-22.jsonl"
    rows = [json.loads(x) for x in out.read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 4  # two posts x two articles


def test_run_search_honours_limit(tmp_path):
    c, _, _ = make_client(base_routes("1"))
    assert ea.run_search(c, BASE, "بانک", tmp_path, "2026-10-22", limit=1) == 0
    out = tmp_path / "ekhtebar_api_search_2026-10-22.jsonl"
    rows = [json.loads(x) for x in out.read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 2  # only the first post
    assert {r["law_id"] for r in rows} == {"sync_ekhtebar_501"}


def test_never_overwrites_existing_output(tmp_path):
    p = tmp_path / "ekhtebar_api_tag_2026-10-22.jsonl"
    p.write_text("keep", encoding="utf-8")
    c, _, _ = make_client(base_routes("1"))
    with pytest.raises(SystemExit):
        ea.run_tag(c, BASE, TAG_SLUG, tmp_path, "2026-10-22")
    assert p.read_text(encoding="utf-8") == "keep"


# ---------------------------------------------------------------- gaps
def test_load_corpus_names_plain_and_manifest():
    plain = ea.load_corpus_names(FX / "corpus_laws.txt")
    manifest = ea.load_corpus_names(FX / "coverage_manifest.json")
    assert plain == manifest
    assert ea.ss().norm_name("آیین‌نامه آزمایشی نمونه") in plain


def test_run_gaps_stages_only_missing_laws(tmp_path):
    c, _, _ = make_client(base_routes("2"))
    rc = ea.run_gaps(c, BASE, FX / "corpus_laws.txt", tmp_path, "2026-10-22", tags=[TAG_SLUG])
    assert rc == 0
    out = tmp_path / "ekhtebar_api_gaps_2026-10-22.jsonl"
    rows = [json.loads(x) for x in out.read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 2
    assert {r["law_id"] for r in rows} == {"sync_ekhtebar_502"}
    report = (tmp_path / "ekhtebar_api_gaps_2026-10-22.md").read_text(encoding="utf-8")
    assert "بخشنامه جدید بانک مرکزی" in report
