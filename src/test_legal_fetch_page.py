"""Offline tests for scripts/legal_fetch_page.py (no network)."""

import importlib.util
from pathlib import Path

import pytest

lfp = None  # populated by the fixture before any test runs (no import-time code)


@pytest.fixture(scope="module", autouse=True)
def _load_fetcher_module():
    global lfp
    if lfp is None:
        path = Path(__file__).resolve().parent.parent / "scripts" / "legal_fetch_page.py"
        spec = importlib.util.spec_from_file_location("legal_fetch_page", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        lfp = module


def test_entry_content_preferred_and_stops():
    html = (
        "<body><p>before</p><div class='x entry-content'><p>inside</p></div>"
        "<p>after</p></body>"
    )
    text = lfp.extract_main_text(html)
    assert "inside" in text
    assert "before" not in text
    assert "after" not in text


def test_article_fallback():
    html = "<body><p>outside</p><article><p>art</p></article></body>"
    assert lfp.extract_main_text(html) == "art"


def test_body_fallback():
    html = "<html><head><title>t</title></head><body><p>b1</p></body></html>"
    assert lfp.extract_main_text(html) == "b1"


def test_whole_document_fallback():
    assert lfp.extract_main_text("just text") == "just text"


def test_skip_tags_dropped():
    html = (
        "<body><nav>menu</nav><script>var a=1;</script><style>.a{}</style>"
        "<p>keep</p><footer>foot</footer></body>"
    )
    text = lfp.extract_main_text(html)
    assert text == "keep"


def test_nested_divs_kept():
    html = (
        "<div class='entry-content'><div><div>deep</div>mid</div>"
        "<img src='a'><p>tail</p></div><p>out</p>"
    )
    text = lfp.extract_main_text(html)
    assert "deep" in text and "mid" in text and "tail" in text
    assert "out" not in text


def test_block_tags_make_lines():
    html = "<div class='entry-content'><p>a</p><p>b</p>c<br>d<li>e</li></div>"
    assert lfp.extract_main_text(html).split("\n") == ["a", "", "b", "", "c", "d", "e"] or (
        lfp.extract_main_text(html).split("\n")[0] == "a"
        and {"a", "b", "c", "d", "e"} <= set(lfp.extract_main_text(html).split("\n"))
    )


def test_count_articles():
    text = "ماده ۱۲\nمتن\nماده 3\nماده ٤\nطبق ماده ۵ قانون"
    assert lfp.count_articles(text) == 3


def test_zwnj_preserved():
    html = "<div class='entry-content'><p>می‌شود</p></div>"
    assert "می‌شود" in lfp.extract_main_text(html)


@pytest.mark.parametrize("url", ["ftp://x", "file:///etc/passwd"])
def test_fetch_rejects_bad_scheme(url):
    with pytest.raises(ValueError):
        lfp.fetch_html(url)


def test_encode_url_persian_path():
    from urllib.parse import unquote, urlsplit

    url = "https://www.ekhtebar.ir/متن-قانون-چک-با-آخرین-اصلاحات/?q=چک"
    enc = lfp._encode_url(url)
    assert enc.isascii()
    assert unquote(urlsplit(enc).path) == "/متن-قانون-چک-با-آخرین-اصلاحات/"
    assert unquote(enc) == url


def test_encode_url_already_encoded_unchanged():
    url = "https://example.com/%D9%85%D8%AA%D9%86/a?x=%D8%AA"
    assert lfp._encode_url(url) == url


def test_encode_url_ascii_unchanged():
    url = "https://example.com/a/b-c_d.html?x=1&y=2"
    assert lfp._encode_url(url) == url


def test_encode_url_idna_host():
    assert lfp._encode_url("https://bücher.example/x").startswith("https://xn--bcher-kva.example/")


def test_main_short_returns_2(tmp_path, monkeypatch):
    monkeypatch.setattr(lfp, "fetch_html", lambda url, timeout=30: "<p>short</p>")
    out = tmp_path / "o.txt"
    assert lfp.main(["http://x", "--out", str(out), "--sleep", "0"]) == 2
    assert not out.exists()


def test_main_long_writes(tmp_path, monkeypatch):
    body = "<div class='entry-content'><p>ماده ۱ " + "متن " * 200 + "</p></div>"
    monkeypatch.setattr(lfp, "fetch_html", lambda url, timeout=30: body)
    out = tmp_path / "sub" / "o.txt"
    assert lfp.main(["http://x", "--out", str(out), "--sleep", "0"]) == 0
    assert out.read_text(encoding="utf-8").startswith("ماده ۱")


def test_leading_zwnj_line_counted():
    html = "<div class='entry-content'><p>\u200cماده 1 - متن قانون</p></div>"
    text = lfp.extract_main_text(html)
    assert text.startswith("ماده 1")
    assert lfp.count_articles(text) == 1


def test_leading_and_trailing_marks_stripped_inside_kept():
    html = "<div class='entry-content'><p>\u200eماده ۱ می\u200cشود\u200f</p></div>"
    text = lfp.extract_main_text(html)
    assert text == "ماده ۱ می\u200cشود"


def test_made_vahede_counted():
    assert lfp.count_articles("ماده واحده\nمتن") == 1


def test_stop_marker_cuts():
    text = "a\nماده 1\nSTOP here\nماده 2"
    assert lfp.apply_markers(text, stop_markers=["STOP"]) == "a\nماده 1"
    assert lfp.apply_markers(text, stop_markers=["ماده 2"]) == "a\nماده 1\nSTOP here"


def test_start_marker_keeps_line():
    text = "chrome\nماده 1\nمتن"
    assert lfp.apply_markers(text, start_marker="ماده 1") == "ماده 1\nمتن"


def test_markers_absent_unchanged():
    text = "a\nb\nc"
    assert lfp.apply_markers(text) == text
    assert lfp.apply_markers(text, start_marker="zzz", stop_markers=["qqq"]) == text
