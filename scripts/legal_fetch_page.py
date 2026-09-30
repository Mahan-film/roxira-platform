"""Fetch one legal web page and save its main text (deterministic, no LLM, no keys).

Usage:
    python3 scripts/legal_fetch_page.py <url> --out data/raw/phase1/<slug>.txt \
        [--selector-class entry-content] [--sleep 2]

Sources fetched this way are tier "secondary" unless the URL is an official portal.
"""

import argparse
import re
import sys
import time
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, urlparse, urlsplit, urlunsplit

USER_AGENT = "RoxiraLegalFetcher/1.0 (+https://ghazihoushmand.ir)"
VOID_TAGS = {
    "br", "img", "hr", "input", "meta", "link", "area", "base", "col",
    "embed", "source", "track", "wbr", "param",
}
SKIP_TAGS = {"script", "style", "nav", "header", "footer", "aside", "form", "noscript"}
BLOCK_TAGS = {
    "p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6",
    "tr", "section", "blockquote",
}
MIN_CHARS = 500

_ARTICLE_RE = re.compile(r"^\s*ماده\s*(?:[۰-۹٠-٩0-9]+|واحده)", re.MULTILINE)
_EDGE_MARKS = "\u200c\u200f\u200e\ufeff"


def _encode_url(url: str) -> str:
    """Percent-encode path/query (keeping existing %XX) and IDNA-encode the host."""
    parts = urlsplit(url)
    netloc = parts.netloc
    host = parts.hostname or ""
    if host and not host.isascii():
        userinfo, _, hostport = netloc.rpartition("@")
        port = f":{parts.port}" if parts.port else ""
        netloc = (f"{userinfo}@" if userinfo else "") + host.encode("idna").decode("ascii") + port
    safe = "/%:@!$&'()*+,;=~-._"
    path = quote(parts.path, safe=safe)
    query = quote(parts.query, safe=safe + "?")
    return urlunsplit((parts.scheme, netloc, path, query, parts.fragment))


def fetch_html(url: str, timeout: int = 30) -> str:
    if urlparse(url).scheme not in ("http", "https"):
        raise ValueError(f"only http/https URLs are allowed: {url!r}")
    url = _encode_url(url)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
        return resp.read().decode("utf-8", errors="replace")


class _Capture:
    def __init__(self):
        self.parts = []
        self.active = False
        self.done = False
        self.found = False
        self.level = 0

    def start(self, level):
        if not self.found:
            self.found = True
            self.active = True
            self.level = level


class _Extractor(HTMLParser):
    def __init__(self, selector_class):
        super().__init__(convert_charrefs=True)
        self.selector_class = selector_class
        self.stack = []
        self.skip_level = None
        self.target = _Capture()
        self.article = _Capture()
        self.body = _Capture()
        self.whole = _Capture()
        self.whole.start(0)

    def _all(self):
        return (self.target, self.article, self.body, self.whole)

    def _emit(self, s):
        for c in self._all():
            if c.active:
                c.parts.append(s)

    def handle_starttag(self, tag, attrs):
        if tag in VOID_TAGS:
            if tag in BLOCK_TAGS and self.skip_level is None:
                self._emit("\n")
            return
        self.stack.append(tag)
        level = len(self.stack)
        if self.skip_level is None and tag in SKIP_TAGS:
            self.skip_level = level
        if tag in BLOCK_TAGS and self.skip_level is None:
            self._emit("\n")
        classes = (dict(attrs).get("class") or "").split()
        if self.selector_class in classes:
            self.target.start(level)
        if tag == "article":
            self.article.start(level)
        if tag == "body":
            self.body.start(level)

    def handle_startendtag(self, tag, attrs):
        if tag in BLOCK_TAGS and self.skip_level is None:
            self._emit("\n")

    def handle_endtag(self, tag):
        if tag in VOID_TAGS or tag not in self.stack:
            return
        while self.stack:
            popped = self.stack.pop()
            if popped == tag:
                break
        level = len(self.stack)
        if self.skip_level is None and tag in BLOCK_TAGS:
            self._emit("\n")
        if self.skip_level is not None and level < self.skip_level:
            self.skip_level = None
        for c in (self.target, self.article, self.body):
            if c.active and level < c.level:
                c.active = False

    def handle_data(self, data):
        if self.skip_level is None:
            self._emit(data)


def _normalize(text: str) -> str:
    out = []
    blank = False
    for line in text.split("\n"):
        line = re.sub(r"[ \t]+", " ", line)
        line = line.strip().strip(_EDGE_MARKS).strip()
        if not line:
            blank = True
            continue
        if blank and out:
            out.append("")
        blank = False
        out.append(line)
    return "\n".join(out)


def extract_main_text(html: str, selector_class: str = "entry-content") -> str:
    p = _Extractor(selector_class)
    p.feed(html)
    p.close()
    for c in (p.target, p.article, p.body):
        if c.found:
            return _normalize("".join(c.parts))
    return _normalize("".join(p.whole.parts))


def count_articles(text: str) -> int:
    return len(_ARTICLE_RE.findall(text))


def first_article_line(text: str) -> str:
    for line in text.split("\n"):
        if _ARTICLE_RE.match(line):
            return line[:40]
    return ""


def apply_markers(text, start_marker=None, stop_markers=None) -> str:
    lines = text.split("\n")
    if start_marker:
        for i, line in enumerate(lines):
            if start_marker in line:
                lines = lines[i:]
                break
    if stop_markers:
        for i, line in enumerate(lines):
            if any(line == m or line.startswith(m) for m in stop_markers):
                lines = lines[:i]
                break
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Fetch a legal page and save its main text.")
    ap.add_argument("url")
    ap.add_argument("--out", required=True)
    ap.add_argument("--selector-class", default="entry-content")
    ap.add_argument("--sleep", type=float, default=2)
    ap.add_argument("--start-marker", default=None)
    ap.add_argument("--stop-marker", action="append", default=None)
    args = ap.parse_args(argv)

    html = fetch_html(args.url)
    time.sleep(args.sleep)
    text = extract_main_text(html, args.selector_class)
    text = apply_markers(text, args.start_marker, args.stop_marker)
    if len(text) < MIN_CHARS:
        print(f"too short: chars={len(text)} (min {MIN_CHARS}); nothing written", file=sys.stderr)
        return 2
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    print(
        f"chars={len(text)} articles={count_articles(text)} "
        f"first={first_article_line(text)} out={out}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
