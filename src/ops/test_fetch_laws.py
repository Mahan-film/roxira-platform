"""Offline tests for scripts/legal/fetch_laws.py (injected fake transport, no network)."""

# ruff: noqa: RUF001
import importlib.util
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

import pytest

ROOT = Path(__file__).resolve().parents[2]
fl = None


@pytest.fixture(autouse=True, scope="module")
def _load_script():
    """Load the script inside a fixture (no import-time code in this file)."""
    global fl
    path = ROOT / "scripts/legal/fetch_laws.py"
    spec = importlib.util.spec_from_file_location("fetch_laws", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["fetch_laws"] = module
    spec.loader.exec_module(module)
    fl = module
    yield


# ---------------------------------------------------------------- builders (no import-time work)
def law(i="cyber"):
    return {
        "id": i,
        "title_fa": "قانون جرایم رایانه‌ای",
        "query_fa": "قانون جرایم رایانه‌ای",
        "topic": "cyber",
        "priority": 1,
    }


def body_text(n=3, extra=""):
    return (
        "".join(
            f"<p>ماده {i} - متن کامل ماده شماره {i} " + "الف ب پ " * 20 + "</p>"
            for i in range(1, n + 1)
        )
        + extra
    )


def ekhtebar_search():
    return "<h2><a href='/cyber-law/'>قانون جرایم رایانه‌ای</a></h2>"


def ekhtebar_page(n=3):
    inner = body_text(n)
    return f"<html><body><article><div class='entry-content'>{inner}</div></article></body></html>"


def qavanin_search():
    return "<html><body><a href='/law/123'>قانون جرایم رایانه‌ای</a></body></html>"


def wiki_search():
    return json.dumps({"query": {"search": [{"title": "قانون جرایم رایانه‌ای"}]}})


def wiki_parse(n=3):
    return json.dumps({"parse": {"text": f"<div>{body_text(n)}</div>"}})


class FakeNet:
    """host -> handler(path_and_query) -> (status, body). Unknown host/path: 404."""

    def __init__(self, handlers=None, robots=None):
        self.handlers = handlers or {}
        self.robots = robots or {}
        self.calls = []
        self.headers_seen = []

    def __call__(self, url, headers):
        self.calls.append(url)
        self.headers_seen.append(dict(headers))
        u = urlparse(url)
        pq = u.path + (("?" + u.query) if u.query else "")
        if u.path == "/robots.txt":
            return (
                200,
                {},
                self.robots.get(u.hostname, "User-agent: *\nDisallow: /wp-admin/\n").encode(),
            )
        h = self.handlers.get(u.hostname)
        if h is None:
            return 404, {}, b""
        res = h(pq)
        if isinstance(res, Exception):
            raise res
        status, body = res
        return status, {}, body.encode() if isinstance(body, str) else body

    def hits(self, host):
        return [
            u for u in self.calls if urlparse(u).hostname == host and not u.endswith("/robots.txt")
        ]


def make_ctx(net, **kw):
    clock = {"t": 0.0}
    sleeps = []

    def sleep(s):
        sleeps.append(s)
        clock["t"] += s

    http = fl.HostHttp(
        net,
        fl.DEFAULT_ALLOWED,
        retries=kw.pop("retries", 2),
        sleep=sleep,
        clock=lambda: clock["t"],
        rng=lambda: 0.0,
    )
    ctx = fl.Ctx(http, **kw)
    ctx.sleeps = sleeps
    return ctx


def run(laws, out, ctx, **kw):
    kw.setdefault("cross_check", False)
    return fl.run_download(laws, out, ctx, log=lambda _m: None, **kw)


def entry(out, lid="cyber"):
    return json.loads((out / "manifest.json").read_text(encoding="utf-8"))["laws"][lid]


def sources_tried(e):
    return [a["source"] for a in e["attempts"]]


# ---------------------------------------------------------------- tests
def test_fallback_order_goes_to_next_source(tmp_path):
    net = FakeNet(
        {
            "www.ekhtebar.ir": lambda pq: (200, "<html><body>nothing</body></html>"),
            "qavanin.ir": lambda pq: (
                (200, qavanin_search()) if pq.startswith("/?q=") else (200, ekhtebar_page())
            ),
        }
    )
    run([law()], tmp_path, make_ctx(net))
    e = entry(tmp_path)
    assert e["status"] == "done" and e["source"] == "qavanin"
    assert sources_tried(e)[:2] == ["ekhtebar", "qavanin"]
    assert "qavanin_selectors_unverified" in e["reasons"] and e["needs_human_check"]
    assert (tmp_path / "cyber.txt").is_file()


def test_ekhtebar_first_when_it_works(tmp_path):
    net = FakeNet(
        {
            "www.ekhtebar.ir": lambda pq: (
                (200, ekhtebar_search()) if pq.startswith("/?s=") else (200, ekhtebar_page())
            ),
        }
    )
    run([law()], tmp_path, make_ctx(net))
    e = entry(tmp_path)
    assert e["source"] == "ekhtebar" and not e["needs_human_check"]
    assert net.hits("qavanin.ir") == []


def test_circuit_breaker_skips_failing_source(tmp_path):
    net = FakeNet(
        {
            "www.ekhtebar.ir": lambda pq: (500, ""),
            "fa.wikisource.org": lambda pq: (
                (200, wiki_search()) if "list=search" in pq else (200, wiki_parse())
            ),
        }
    )
    laws = [law("a"), law("b"), law("c")]
    run(laws, tmp_path, make_ctx(net, retries=1), max_failures=2, skip={"qavanin"})
    third = entry(tmp_path, "c")
    assert third["source"] == "wikisource"
    assert {
        "source": "ekhtebar",
        "step": "skipped",
        "status": "skipped",
        "reason": "circuit_open",
        "phase": "primary",
    } in third["attempts"]
    # only the first two laws touched ekhtebar (one search request each)
    assert len(net.hits("www.ekhtebar.ir")) == 2


def test_403_is_not_retried_or_bypassed(tmp_path):
    net = FakeNet(
        {
            "www.ekhtebar.ir": lambda pq: (403, "denied"),
            "fa.wikisource.org": lambda pq: (
                (200, wiki_search()) if "list=search" in pq else (200, wiki_parse())
            ),
        }
    )
    run([law("a"), law("b")], tmp_path, make_ctx(net, retries=3), skip={"qavanin"})
    assert len(net.hits("www.ekhtebar.ir")) == 1  # one request, never retried, host left alone
    assert entry(tmp_path, "a")["source"] == "wikisource"
    assert entry(tmp_path, "b")["source"] == "wikisource"
    uas = {h["User-Agent"] for h in net.headers_seen}
    assert len(uas) == 1 and "RoxiraLegalResearchBot" in uas.pop()  # no header spoofing
    reasons = [a.get("reason") for a in entry(tmp_path, "a")["attempts"]]
    assert "denied_http_403" in reasons


def test_429_backs_off_and_moves_on(tmp_path):
    net = FakeNet({"www.ekhtebar.ir": lambda pq: (429, "")})
    ctx = make_ctx(net, retries=3)
    run([law()], tmp_path, ctx, skip={"qavanin", "wikisource", "discovery", "archive"})
    assert len(net.hits("www.ekhtebar.ir")) == 1
    assert entry(tmp_path)["status"] == "gave_up"


def test_archive_fallback_for_failed_page(tmp_path):
    snap = "http://web.archive.org/web/20240101000000/https://www.ekhtebar.ir/cyber-law/"
    net = FakeNet(
        {
            "www.ekhtebar.ir": lambda pq: (
                (200, ekhtebar_search()) if pq.startswith("/?s=") else (500, "")
            ),
            "archive.org": lambda pq: (
                200,
                json.dumps({"archived_snapshots": {"closest": {"available": True, "url": snap}}}),
            ),
            "web.archive.org": lambda pq: (200, ekhtebar_page()),
        }
    )
    run([law()], tmp_path, make_ctx(net, retries=1), skip={"qavanin", "wikisource", "discovery"})
    e = entry(tmp_path)
    assert e["source"] == "archive" and e["needs_human_check"]
    assert "archive_snapshot_may_be_stale" in e["reasons"]
    assert e["source_url"].startswith("https://www.ekhtebar.ir/")
    assert any("/web/20240101000000id_/" in u for u in net.hits("web.archive.org"))


def test_archive_cdx_when_availability_empty(tmp_path):
    cdx = json.dumps(
        [
            ["urlkey", "timestamp", "original"],
            ["k", "20230505000000", "https://www.ekhtebar.ir/cyber-law/"],
        ]
    )

    def archive(pq):
        if pq.startswith("/wayback/available"):
            return 200, json.dumps({"archived_snapshots": {}})
        return 200, cdx

    net = FakeNet(
        {
            "www.ekhtebar.ir": lambda pq: (
                (200, ekhtebar_search()) if pq.startswith("/?s=") else (404, "")
            ),
            "archive.org": archive,
            "web.archive.org": lambda pq: (
                (200, cdx) if pq.startswith("/cdx") else (200, ekhtebar_page())
            ),
        }
    )
    run([law()], tmp_path, make_ctx(net, retries=1), skip={"qavanin", "wikisource", "discovery"})
    assert entry(tmp_path)["source"] == "archive"


def test_disagreement_is_flagged(tmp_path):
    net = FakeNet(
        {
            "www.ekhtebar.ir": lambda pq: (
                (200, ekhtebar_search()) if pq.startswith("/?s=") else (200, ekhtebar_page(8))
            ),
            "fa.wikisource.org": lambda pq: (
                (200, wiki_search()) if "list=search" in pq else (200, wiki_parse(3))
            ),
        }
    )
    run([law()], tmp_path, make_ctx(net), cross_check=True, skip={"qavanin"})
    e = entry(tmp_path)
    assert e["source"] == "ekhtebar"
    assert e["cross_check"]["status"] == "disagree" and e["cross_check"]["with"] == "wikisource"
    assert "sources_disagree" in e["reasons"] and e["needs_human_check"]


def test_agreement_not_flagged(tmp_path):
    net = FakeNet(
        {
            "www.ekhtebar.ir": lambda pq: (
                (200, ekhtebar_search()) if pq.startswith("/?s=") else (200, ekhtebar_page(3))
            ),
            "fa.wikisource.org": lambda pq: (
                (200, wiki_search()) if "list=search" in pq else (200, wiki_parse(3))
            ),
        }
    )
    run([law()], tmp_path, make_ctx(net), cross_check=True, skip={"qavanin"})
    e = entry(tmp_path)
    assert e["cross_check"]["status"] == "agree" and not e["needs_human_check"]


def test_compare_texts_basic():
    assert fl.compare_texts("ماده ۱ الف", "ماده 1 الف")[0]
    assert not fl.compare_texts("x " * 100, "x " * 10)[0]


def test_resume_skips_done_laws(tmp_path):
    net = FakeNet(
        {
            "www.ekhtebar.ir": lambda pq: (
                (200, ekhtebar_search()) if pq.startswith("/?s=") else (200, ekhtebar_page())
            )
        }
    )
    run([law()], tmp_path, make_ctx(net))
    net2 = FakeNet()
    counts = run([law()], tmp_path, make_ctx(net2))
    assert counts["skipped_resume"] == 1 and net2.calls == []


def test_gave_up_is_retried_on_resume(tmp_path):
    run([law()], tmp_path, make_ctx(FakeNet()), skip={"discovery"})
    assert entry(tmp_path)["status"] == "gave_up"
    net = FakeNet(
        {
            "www.ekhtebar.ir": lambda pq: (
                (200, ekhtebar_search()) if pq.startswith("/?s=") else (200, ekhtebar_page())
            )
        }
    )
    run([law()], tmp_path, make_ctx(net))
    assert entry(tmp_path)["status"] == "done"


def test_robots_deny_is_honoured(tmp_path):
    net = FakeNet(
        {
            "qavanin.ir": lambda pq: (200, qavanin_search()),
            "fa.wikisource.org": lambda pq: (
                (200, wiki_search()) if "list=search" in pq else (200, wiki_parse())
            ),
        },
        robots={"qavanin.ir": "User-agent: *\nDisallow: /\n"},
    )
    run([law()], tmp_path, make_ctx(net), skip={"ekhtebar"})
    e = entry(tmp_path)
    assert e["source"] == "wikisource"
    assert net.hits("qavanin.ir") == []  # never requested
    assert any(str(a.get("reason", "")).startswith("robots_denied") for a in e["attempts"])


def test_login_path_and_unlisted_host_blocked(tmp_path):
    ctx = make_ctx(FakeNet())
    with pytest.raises(fl.Blocked):
        ctx.http.get("https://www.ekhtebar.ir/wp-login.php")
    with pytest.raises(fl.Blocked):
        ctx.http.get("https://evil.example.com/x")


def test_per_host_delay_at_least_3_seconds(tmp_path):
    net = FakeNet({"www.ekhtebar.ir": lambda pq: (200, "<html></html>")})
    ctx = make_ctx(net)
    ctx.http.get("https://www.ekhtebar.ir/a")
    ctx.http.get("https://www.ekhtebar.ir/b")
    assert max(ctx.sleeps) >= 3.0
    with pytest.raises(ValueError):
        fl.HostHttp(net, fl.DEFAULT_ALLOWED, delay=1.0)


def test_retry_backoff_is_exponential_with_jitter(tmp_path):
    n = {"c": 0}

    def flaky(pq):
        n["c"] += 1
        return (503, "") if n["c"] < 3 else (200, "ok")

    ctx = make_ctx(FakeNet({"www.ekhtebar.ir": flaky}), retries=3)
    ctx.http.rng = lambda: 1.0
    status, _, _, _ = ctx.http.get("https://www.ekhtebar.ir/x")
    assert status == 200
    backoffs = [s for s in ctx.sleeps if s in (3.0, 6.0)]
    assert backoffs  # jitter 1.5x of 2s and 4s
    assert 3.0 in ctx.sleeps and 6.0 in ctx.sleeps


def test_discovery_uses_allowlisted_results_only(tmp_path):
    def search(query, **_kw):
        return {
            "provider": "fake",
            "attempts": [],
            "results": [
                {"url": "https://evil.example.com/law", "title": "قانون جرایم رایانه‌ای"},
                {"url": "https://rc.majlis.ir/fa/law/show/1", "title": "قانون جرایم رایانه‌ای"},
            ],
        }

    net = FakeNet(
        {
            "rc.majlis.ir": lambda pq: (200, ekhtebar_page()),
            "evil.example.com": lambda pq: (200, ekhtebar_page()),
        }
    )
    run(
        [law()],
        tmp_path,
        make_ctx(net, search_fn=search),
        skip={"ekhtebar", "qavanin", "wikisource", "archive"},
    )
    e = entry(tmp_path)
    assert e["source"] == "discovery" and "found_by_search_engine" in e["reasons"]
    assert net.hits("evil.example.com") == []


def test_discovery_without_keys_fails_softly(tmp_path):
    def search(query, **_kw):
        raise fl.AllStepsFailed([])

    run(
        [law()],
        tmp_path,
        make_ctx(FakeNet(), search_fn=search),
        skip={"ekhtebar", "qavanin", "wikisource", "archive"},
    )
    e = entry(tmp_path)
    assert e["status"] == "gave_up"
    assert e["attempts"][-1]["reason"] == "search_unavailable_or_no_keys"


def test_report_gave_up_and_done(tmp_path):
    net = FakeNet(
        {
            "www.ekhtebar.ir": lambda pq: (
                (200, ekhtebar_search()) if pq.startswith("/?s=") else (200, ekhtebar_page())
            )
        }
    )
    run([law("ok")], tmp_path, make_ctx(net))
    run([law("bad")], tmp_path, make_ctx(FakeNet()), skip={"discovery"})
    lines = []
    summary = fl.report([law("ok"), law("bad"), law("new")], tmp_path, log=lines.append)
    text = "\n".join(lines)
    assert "ok: got it from ekhtebar" in text
    assert "bad: GAVE UP after trying: ekhtebar(" in text and "next:" in text
    assert "new: NOT ATTEMPTED" in text
    assert summary == {"done": 1, "gave_up": 1, "not_attempted": 1, "flagged": 0}


def test_dry_run_downloads_nothing(tmp_path):
    net = FakeNet(
        {
            "www.ekhtebar.ir": lambda pq: (
                (200, ekhtebar_search()) if pq.startswith("/?s=") else (200, ekhtebar_page())
            )
        }
    )
    run([law()], tmp_path, make_ctx(net), dry_run=True)
    assert not (tmp_path / "manifest.json").exists()
    assert all("/cyber-law/" not in u for u in net.calls)


def test_staged_rows_keep_real_source(tmp_path):
    net = FakeNet(
        {
            "qavanin.ir": lambda pq: (
                (200, qavanin_search()) if pq.startswith("/?q=") else (200, ekhtebar_page())
            )
        }
    )
    run([law()], tmp_path, make_ctx(net), skip={"ekhtebar"})
    fl.fe.run_to_staged(tmp_path, include_flagged=True, log=lambda _m: None)
    rows = [
        json.loads(x)
        for x in (tmp_path / "staged_ekhtebar.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert rows and rows[0]["source"] == "qavanin.ir" and rows[0]["law_id"] == "qavanin_cyber"
    assert rows[0]["needs_review"] and rows[0]["source_tier"] == "unofficial"


def test_out_inside_repo_refused(capsys):
    rc = fl.main(["--out", str(ROOT / "data" / "x"), "--dry-run"], transport=FakeNet())
    assert rc == 2
    assert "outside the repository" in capsys.readouterr().err
