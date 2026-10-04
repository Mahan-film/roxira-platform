"""Offline tests for scripts/legal/fetch_ekhtebar.py (fake transport, no network)."""

# ruff: noqa: RUF001

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
fe = None


@pytest.fixture(autouse=True, scope="module")
def _load_script():
    """Load the script inside a fixture (no import-time code in this file)."""
    global fe
    path = ROOT / "scripts/legal/fetch_ekhtebar.py"
    spec = importlib.util.spec_from_file_location("fetch_ekhtebar", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["fetch_ekhtebar"] = module
    spec.loader.exec_module(module)
    fe = module
    yield


def robots(extra=""):
    return "User-agent: *\nDisallow: /wp-admin/\n" + extra


def search_html():
    return (
        "<html><body><nav><a href='/login'>Login here please</a></nav>"
        "<h2><a href='/cyber-law/'>قانون جرایم رایانه‌ای</a></h2>"
        "<h2><a href='/other-law/'>قانون مالیات های مستقیم</a></h2>"
        "<h2><a href='/wp-admin/post.php'>قانون جرایم رایانه ای admin</a></h2></body></html>"
    )


def law_html():
    return (
        "<html><body><header>menu</header><article><div class='entry-content'>"
        "<p>ماده ۱ - متن اول</p><p>ماده ۲ - متن دوم طبق ماده ۱</p></div></article>"
        "<footer>foot</footer></body></html>"
    )


def the_law():
    return {
        "id": "cyber",
        "title_fa": "قانون جرایم رایانه‌ای",
        "query_fa": "قانون جرایم رایانه‌ای",
        "topic": "cyber",
        "priority": 1,
    }


class FakeNet:
    def __init__(self, pages=None, robots_body=None, robots_status=200):
        self.pages = pages or {}
        self.robots_body = robots() if robots_body is None else robots_body
        self.robots_status = robots_status
        self.calls = []

    def __call__(self, url, headers):
        self.calls.append(url)
        assert "RoxiraLegalResearchBot" in headers["User-Agent"]
        path = url.replace("https://www.ekhtebar.ir", "")
        if path == "/robots.txt":
            return self.robots_status, {}, self.robots_body.encode()
        for key, val in self.pages.items():
            if path.startswith(key):
                return 200, {}, val if isinstance(val, bytes) else val.encode()
        return 404, {}, b""


def make_fetcher(net, **kw):
    clock = {"t": 0.0}
    sleeps = []

    def sleep(s):
        sleeps.append(s)
        clock["t"] += s

    f = fe.Fetcher(net, sleep=sleep, clock=lambda: clock["t"], **kw)
    f.sleeps = sleeps
    return f


def read_manifest(out):
    return json.loads((out / "manifest.json").read_text(encoding="utf-8"))


def test_robots_disallow_respected_and_login_guard():
    net = FakeNet(robots_body=robots("Disallow: /private/\n"))
    f = make_fetcher(net)
    f.load_robots()
    assert f.allowed("https://www.ekhtebar.ir/cyber-law/")
    assert not f.allowed("https://www.ekhtebar.ir/private/x")
    assert not f.allowed("https://www.ekhtebar.ir/wp-admin/x")
    assert not f.allowed("https://www.ekhtebar.ir/wp-login.php")
    assert not f.allowed("https://evil.example/cyber-law/")
    with pytest.raises(fe.Blocked):
        f.get("https://www.ekhtebar.ir/private/x")
    assert not any("private" in c for c in net.calls)


def test_unreadable_robots_refuses_to_crawl():
    f = make_fetcher(FakeNet(robots_status=500), retries=1)
    with pytest.raises(fe.FetchError):
        f.load_robots()


def test_delay_minimum_and_enforced():
    with pytest.raises(ValueError):
        fe.Fetcher(FakeNet(), delay=1.0)
    net = FakeNet({"/a": "x", "/b": "y"})
    f = make_fetcher(net)
    f.load_robots()
    f.get("https://www.ekhtebar.ir/a")
    f.get("https://www.ekhtebar.ir/b")
    assert len(f.sleeps) == 2 and all(s >= 3.0 - 1e-9 for s in f.sleeps)


def test_retry_backoff_and_circuit_breaker():
    def failing(url, headers):
        raise OSError("down")

    f = make_fetcher(failing, retries=2, max_failures=2)
    with pytest.raises(fe.FetchError):
        f._request("https://www.ekhtebar.ir/x")
    assert any(s >= 2.0 for s in f.sleeps)
    with pytest.raises(fe.StopRun):
        f._request("https://www.ekhtebar.ir/x")


def test_candidates_low_similarity_flagged_and_admin_excluded():
    cands = fe.search_candidates(
        search_html(), "https://www.ekhtebar.ir/?s=q", the_law()["title_fa"]
    )
    assert cands[0]["url"].endswith("/cyber-law/")
    assert all("wp-admin" not in c["url"] and "login" not in c["url"] for c in cands)
    chosen, flag, _ = fe.choose(cands)
    assert chosen["url"].endswith("/cyber-law/") and not flag
    low = [{"url": "u", "title": "x", "score": 0.3}]
    assert fe.choose(low)[1:] == (True, ["low_similarity"])
    close = [{"url": "a", "title": "t", "score": 0.9}, {"url": "b", "title": "t", "score": 0.88}]
    assert "several_close_candidates" in fe.choose(close)[2]
    assert fe.choose([])[1:] == (True, ["no_candidates"])


def test_download_resume_and_text_fallback(tmp_path):
    net = FakeNet({"/?s=": search_html(), "/cyber-law/": law_html()})
    c1 = fe.run_download([the_law()], tmp_path, make_fetcher(net), log=lambda s: None)
    assert c1["done"] == 1
    ent = read_manifest(tmp_path)["laws"]["cyber"]
    assert ent["kind"] == "text" and len(ent["sha256"]) == 64 and ent["bytes"] > 0
    assert ent["source_url"].endswith("/cyber-law/") and ent["candidates"] and ent["fetched_at"]
    text = (tmp_path / ent["file"]).read_text(encoding="utf-8")
    assert "menu" not in text and "foot" not in text and "ماده ۱" in text
    n = len(net.calls)
    c2 = fe.run_download([the_law()], tmp_path, make_fetcher(net), log=lambda s: None)
    assert c2["skipped_resume"] == 1 and c2["done"] == 0
    assert all("/cyber-law/" not in c for c in net.calls[n:])


def test_pdf_preferred_when_linked(tmp_path):
    html = law_html().replace("</article>", "<a href='/wp-content/u/cyber.pdf'>PDF</a></article>")
    pages = {
        "/?s=": search_html(),
        "/cyber-law/": html,
        "/wp-content/u/cyber.pdf": b"%PDF-1.4 x",
    }
    fe.run_download([the_law()], tmp_path, make_fetcher(FakeNet(pages)), log=lambda s: None)
    ent = read_manifest(tmp_path)["laws"]["cyber"]
    assert ent["kind"] == "pdf" and (tmp_path / "cyber.pdf").read_bytes().startswith(b"%PDF")


def test_dry_run_writes_nothing(tmp_path):
    net = FakeNet({"/?s=": search_html()})
    out = []
    fe.run_download([the_law()], tmp_path / "o", make_fetcher(net), dry_run=True, log=out.append)
    assert not (tmp_path / "o").exists() and "cyber" in out[0]
    assert not any("/cyber-law/" in c for c in net.calls)


def test_out_must_be_outside_repo(tmp_path):
    with pytest.raises(ValueError):
        fe.assert_outside_repo(ROOT / "data" / "x")
    assert fe.assert_outside_repo(tmp_path) == tmp_path.resolve()
    assert str(fe.default_out()).startswith(str(Path.home()))


def test_digit_normalisation():
    assert fe.normalize_digits("ماده ۱۲ و ٣٤ ك ي") == "ماده 12 و 34 ک ی"


def test_article_splitting_and_staged_rows():
    text = (
        "مقدمه\nماده ۱ - نخست\nادامه طبق ماده ۲ این قانون\nماده ۲- دوم\n"
        "ماده ۱۳ مکرر - سوم\nماده ۲ - تکرار\nماده واحده"
    )
    arts, pre = fe.split_articles(text)
    assert pre > 0
    assert [a["article_no"] for a in arts] == ["1", "2", "13-mokarrar", "2", "1"]
    assert "طبق ماده 2" in arts[0]["text"]
    assert arts[3]["article_label"] == "ماده 2 (2)"
    assert "duplicate_article_number" in arts[3]["reasons"]
    entry = {"id": "cyber", "title_fa": "قانون جرایم رایانه‌ای", "source_url": "u", "topic": "t"}
    rows, _ = fe.staged_rows(entry, text)
    r = rows[0]
    assert r["approval_date"] is None and r["needs_review"] is True
    assert r["source_tier"] == "unofficial"


def test_staged_rows_pass_ingest_gates_except_allowlist():
    spec = importlib.util.spec_from_file_location(
        "ingest_pipeline", ROOT / "scripts/legal/ingest_pipeline.py"
    )
    ip = importlib.util.module_from_spec(spec)
    sys.modules["ingest_pipeline"] = ip
    spec.loader.exec_module(ip)
    entry = {"id": "cyber", "title_fa": "قانون جرایم رایانه‌ای", "source_url": "u", "topic": "t"}
    rows, _ = fe.staged_rows(entry, "ماده ۱ - الف\nماده ۱۳ مکرر - ب\nماده ۲ - ج")
    rep = ip.validate_rows(rows, {})
    assert rep["gate_counts"]["not_in_allowlist"] == 3
    others = sum(v for k, v in rep["gate_counts"].items() if k != "not_in_allowlist")
    assert others == 0
    assert rep["warnings"]["missing_approval_date"] == 3


def test_to_staged_end_to_end_pdf_and_flagged(tmp_path):
    net = FakeNet({"/?s=": search_html(), "/cyber-law/": law_html()})
    fe.run_download([the_law()], tmp_path, make_fetcher(net), log=lambda s: None)
    summ = fe.run_to_staged(tmp_path, log=lambda s: None)
    lines = (tmp_path / fe.STAGED_NAME).read_text(encoding="utf-8").splitlines()
    assert summ["rows"] == 2 and json.loads(lines[1])["article_no"] == "2"
    man = read_manifest(tmp_path)
    man["laws"]["cyber"].update(kind="pdf", file="cyber.pdf")
    (tmp_path / "cyber.pdf").write_bytes(b"%PDF-1.4")
    (tmp_path / "manifest.json").write_text(json.dumps(man), encoding="utf-8")
    s2 = fe.run_to_staged(tmp_path, log=lambda s: None, pdf_reader=lambda p: None)
    assert "pdftotext" in s2["skipped"]["cyber"] and s2["rows"] == 0
    man["laws"]["cyber"].update(kind="text", file="cyber.txt", needs_human_check=True)
    (tmp_path / "manifest.json").write_text(json.dumps(man), encoding="utf-8")
    s3 = fe.run_to_staged(tmp_path, log=lambda s: None)
    assert "needs_human_check" in s3["skipped"]["cyber"]


def test_config_covers_required_laws():
    laws = fe.load_config(ROOT / "config/ekhtebar_laws.json")
    ids = {x["id"] for x in laws}
    assert len(ids) == len(laws) >= 11
    required = {"cybercrime", "ecommerce", "consumer_protection", "direct_taxes"}
    assert required <= ids and "commerce_code_amend_1347" in ids
