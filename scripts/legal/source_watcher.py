#!/usr/bin/env python3
"""Source watcher (R22 pilot): polite, public-only change watcher for Iranian legal sources and Setad listings.

Design: docs/research/R22_SOURCE_WATCHER.md. Stdlib only. No keys, no logins, no CAPTCHA/challenge handling.

  source_watcher.py run [--config FILE] [--only ID ...] [--commit] [--details N] [--max-requests N]
      Default is DRY-RUN/report mode: fetch, classify, diff against saved state, write a report; state and staged
      JSONL are NOT updated. --commit updates the SQLite state and writes data-like staged JSONL (new file per day).
  source_watcher.py status      show hosts' last page state and item counts from the state DB
  source_watcher.py classify FILE   print the page-state class of a saved HTML file (debug aid)

Rules (hard): honest User-Agent; robots.txt honoured when present (a missing robots file is NOT permission: our own
>= 3 s per host delay and a request budget apply); a challenge, WAF block, parked-domain page, login redirect or TLS
error marks the host non-ok for the run and nothing is parsed from it; TLS verification is never disabled (a host may
pin an extra CA file); the proxy environment (HTTPS_PROXY) is honoured, never bypassed; peer addresses are not logged.
"""

# ruff: noqa: E501

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import html
import json
import os
import re
import sqlite3
import ssl
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from html.parser import HTMLParser
from pathlib import Path

USER_AGENT = "RoxiraBot/1.0 (+https://ghazihoushmand.ir)"
MIN_DELAY = 3.0
DEFAULT_CONFIG = Path(__file__).resolve().parents[2] / "config" / "source_watcher.json"
MAX_BODY = 2_000_000

# ---- page-state classification ("200 is not content") -------------------------------------------------------------

OK, CHALLENGE, BLOCKED, PARKED, EMPTY, REDIRECT, LOGIN, TLS_ERROR, NET_ERROR, HTTP_ERROR = (
    "ok",
    "challenge",
    "blocked",
    "parked",
    "empty",
    "redirect",
    "login_required",
    "tls_error",
    "net_error",
    "http_error",
)
NON_OK_STOPS_HOST = {CHALLENGE, BLOCKED, PARKED, LOGIN, TLS_ERROR}

_CHALLENGE_MARKERS = (
    "cdn-cgi/",
    "transferring to the website",
    "just a moment",
    "attention required",
    "arvancloud",
    "checking your browser",
    "ddos protection",
    "g-recaptcha",
    "h-captcha",
    "cf-challenge",
    "captcha-delivery",
)
_BLOCK_MARKERS = (
    "درخواست رد شد",
    "درخواست شما رد",
    "request rejected",
    "access denied",
    "the requested url was rejected",
    "support id",
    "forbidden",
    "دسترسی غیرمجاز",
)
_PARKED_MARKERS = (
    "domain name may be for sale",
    "domain is for sale",
    "this domain is for sale",
    "دامنه برای فروش",
    "این دامنه فروشی",
    "buy this domain",
    "domain parking",
)
_LOGIN_PATH_RE = re.compile(r"(login|signin|sign-in|account/logon|auth|sso)", re.I)


def classify_page(
    status: int, headers: dict, body: bytes, final_url: str = "", requested_url: str = ""
) -> str:
    """Return the page-state class. A 200 is only ok when the body looks like real content."""
    low = {k.lower(): v for k, v in (headers or {}).items()}
    if status in (301, 302, 303, 307, 308):
        loc = low.get("location", "")
        return LOGIN if _LOGIN_PATH_RE.search(urllib.parse.urlparse(loc).path) else REDIRECT
    if final_url and requested_url:
        fp, rp = urllib.parse.urlparse(final_url), urllib.parse.urlparse(requested_url)
        if (
            fp.path != rp.path
            and _LOGIN_PATH_RE.search(fp.path)
            and not _LOGIN_PATH_RE.search(rp.path)
        ):
            return LOGIN
    text = body[:MAX_BODY].decode("utf-8", "replace").lower()
    short = (
        len(body) < 30_000
    )  # challenge/WAF/parked pages are small; big real pages may mention captcha in a form
    if status in (401,):
        return LOGIN
    if status in (403, 429, 451):
        return CHALLENGE if any(m in text for m in _CHALLENGE_MARKERS) else BLOCKED
    if status >= 400:
        return HTTP_ERROR
    if short and any(m in text for m in _CHALLENGE_MARKERS):
        return CHALLENGE
    if short and any(m in text for m in _BLOCK_MARKERS):
        return BLOCKED
    if any(m in text for m in _PARKED_MARKERS) and len(body) < 20_000:
        return PARKED
    if len(re.sub(r"<[^>]+>|\s+", "", text)) < 40 and len(body) < 400:
        return EMPTY
    return OK


# ---- normalisation ------------------------------------------------------------------------------------------------

_DIGITS = {ord(a): str(i) for i, a in enumerate("۰۱۲۳۴۵۶۷۸۹")}
_DIGITS.update({ord(a): str(i) for i, a in enumerate("٠١٢٣٤٥٦٧٨٩")})


def normalize_text(s: str) -> str:
    """NFC, Arabic yeh/kaf -> Persian, Persian/Arabic digits -> ASCII, drop tatweel/ZWJ, collapse whitespace."""
    s = unicodedata.normalize("NFC", html.unescape(s or ""))
    s = (
        s.replace("ي", "ی")
        .replace("ك", "ک")
        .replace("ـ", "")
        .replace("‍", "")
        .replace("‏", "")
        .replace("‎", "")
    )
    s = s.translate(_DIGITS)
    return re.sub(r"\s+", " ", s).strip()


def sha256_text(s: str) -> str:
    return hashlib.sha256(normalize_text(s).encode("utf-8")).hexdigest()


class _Extract(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.links: list[tuple[str, str]] = []
        self.text: list[str] = []
        self._in_title = False
        self._skip = 0
        self._a_href: str | None = None
        self._a_text: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self._in_title = True
        elif tag in ("script", "style", "noscript"):
            self._skip += 1
        elif tag == "a":
            self._a_href = dict(attrs).get("href") or None
            self._a_text = []

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag in ("script", "style", "noscript") and self._skip:
            self._skip -= 1
        elif tag == "a" and self._a_href is not None:
            self.links.append((self._a_href, normalize_text(" ".join(self._a_text))))
            self._a_href = None

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self._skip:
            self.text.append(data)
            if self._a_href is not None:
                self._a_text.append(data)


def extract_page(body: bytes, base_url: str) -> dict:
    p = _Extract()
    p.feed(body[:MAX_BODY].decode("utf-8", "replace"))
    links, seen = [], set()
    for href, text in p.links:
        if href.startswith(("#", "javascript:", "mailto:", "tel:")):
            continue
        url = urllib.parse.urljoin(base_url, href).split("#")[0]
        if urllib.parse.urlparse(url).scheme not in ("http", "https") or url in seen:
            continue
        seen.add(url)
        links.append({"url": url, "title": text})
    return {
        "title": normalize_text(p.title),
        "text": normalize_text(" ".join(p.text)),
        "links": links,
    }


# ---- polite client ------------------------------------------------------------------------------------------------


def iri_to_uri(url: str) -> str:
    """Percent-encode non-ASCII path/query (Persian slugs) so the request line is plain ASCII."""
    u = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit(
        (
            u.scheme,
            u.netloc.encode("idna").decode("ascii") if not u.netloc.isascii() else u.netloc,
            urllib.parse.quote(u.path, safe="/%:@!$&'()*+,;=~-._"),
            urllib.parse.quote(u.query, safe="/%:@!$&'()*+,;=?~-._"),
            "",
        )
    )


def same_site(a: str, b: str) -> bool:
    ha = urllib.parse.urlparse(a).netloc.split(":")[0].lower().removeprefix("www.")
    hb = urllib.parse.urlparse(b).netloc.split(":")[0].lower().removeprefix("www.")
    return bool(ha) and ha == hb


class Skip(Exception):
    """Raised when a request must not be made (budget, robots, host stopped)."""


class Client:
    def __init__(
        self, delay: float = MIN_DELAY, max_requests: int = 40, opener=None, sleep=time.sleep
    ):
        self.delay = max(delay, MIN_DELAY)
        self.max_requests = max_requests
        self.requests = 0
        self._last: dict[str, float] = {}
        self._opener = opener  # test hook: (url, headers, ca_file) -> (status, headers, bytes)
        self._sleep = sleep
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self.last_reason: dict[str, str] = {}  # host -> " (reason)" of the last network failure
        self.tls_max: dict[str, str] = {}  # host -> "1.2": a server that resets TLS 1.3 clients
        self._cookies: dict[str, dict[str, str]] = {}  # host -> name -> value, this run only

    def _ctx(self, ca_file: str | None, host: str = "") -> ssl.SSLContext:
        ctx = ssl.create_default_context()  # verification stays ON
        if self.tls_max.get(host) == "1.2":
            ctx.maximum_version = ssl.TLSVersion.TLSv1_2
        if ca_file:
            ctx.load_verify_locations(cafile=ca_file)
        return ctx

    def fetch(self, url: str, ca_file: str | None = None) -> tuple[str, int, dict, bytes, str]:
        """Like _fetch_once, but follows up to 3 same-site https redirects (www/non-www, path moves).

        A redirect to another site or to a login path is not followed: it is reported as redirect/login_required.
        """
        for _hop in range(4):
            res = self._fetch_once(url, ca_file)
            state, _status, hdrs, _body, _final = res
            if state != REDIRECT:
                return res
            loc = urllib.parse.urljoin(
                url, {k.lower(): v for k, v in hdrs.items()}.get("location", "")
            )
            if not same_site(url, loc) or urllib.parse.urlparse(loc).scheme != "https":
                return res
            url = loc
        return res

    def _fetch_once(
        self, url: str, ca_file: str | None = None
    ) -> tuple[str, int, dict, bytes, str]:
        """Return (state, status, headers, body, final_url). Never raises for network problems."""
        if self.requests >= self.max_requests:
            raise Skip(f"request budget ({self.max_requests}) exhausted")
        host = urllib.parse.urlparse(url).netloc
        gap = time.monotonic() - self._last.get(host, -1e9)
        if gap < self.delay:
            self._sleep(self.delay - gap)
        self._last[host] = time.monotonic()
        self.requests += 1
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
            "Accept-Language": "fa,en;q=0.5",
            "Accept-Encoding": "gzip",
        }
        jar = self._cookies.get(host)
        if jar:
            headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in jar.items())
        try:
            if self._opener:
                status, hdrs, data = self._opener(url, headers, ca_file)
                final = url
            else:
                final, status, hdrs, data = self._urlopen(url, headers, ca_file)
        except ssl.SSLError as exc:
            self.last_reason[host] = f" ({type(exc).__name__})"
            return TLS_ERROR, 0, {"reason": type(exc).__name__}, b"", url
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, ValueError) as exc:
            reason = getattr(exc, "reason", exc)
            self.last_reason[host] = f" ({type(reason).__name__})"
            if isinstance(reason, ssl.SSLError) or "CERTIFICATE" in str(reason).upper():
                return TLS_ERROR, 0, {"reason": "certificate verify failed"}, b"", url
            return NET_ERROR, 0, {"reason": type(reason).__name__}, b"", url
        for line in str(hdrs.get("Set-Cookie", "")).split("\n"):
            pair = line.split(";", 1)[0]
            if "=" in pair:
                k, v = pair.split("=", 1)
                self._cookies.setdefault(host, {})[k.strip()] = v.strip()
        if hdrs.get("Content-Encoding", "").lower() == "gzip":
            try:
                data = gzip.decompress(data)
            except OSError:
                pass
        return classify_page(status, hdrs, data, final, url), status, hdrs, data, final

    def _urlopen(self, url, headers, ca_file):
        class _NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k):  # redirects are classified, not followed
                return None

        opener = urllib.request.build_opener(  # honours HTTPS_PROXY from the environment
            urllib.request.ProxyHandler(),
            urllib.request.HTTPSHandler(
                context=self._ctx(ca_file, urllib.parse.urlparse(url).netloc)
            ),
            _NoRedirect(),
        )
        req = urllib.request.Request(  # http(s) only, checked by caller
            iri_to_uri(url), headers=headers
        )
        try:
            with opener.open(req, timeout=30) as r:
                return r.geturl(), r.status, self._hdrs(r.headers), r.read(MAX_BODY)
        except urllib.error.HTTPError as exc:
            return url, exc.code, self._hdrs(exc.headers), exc.read(MAX_BODY) or b""

    @staticmethod
    def _hdrs(msg) -> dict:
        out = dict(msg or {})
        if msg is not None and hasattr(msg, "get_all"):
            cookies = msg.get_all("Set-Cookie") or []
            if cookies:
                out["Set-Cookie"] = "\n".join(cookies)
        return out

    def robots(
        self, origin: str, ca_file: str | None
    ) -> tuple[urllib.robotparser.RobotFileParser | None, str]:
        """(parser or None when absent/unusable, state). A host whose robots page is a challenge/block is non-ok."""
        if origin in self._robots:
            return self._robots[origin], OK
        state, status, _h, body, _f = self.fetch(origin + "/robots.txt", ca_file)
        rp = None
        if state == OK and status == 200:
            text = body.decode("utf-8", "replace")
            if "<html" in text[:500].lower():
                state = BLOCKED  # an HTML page where a robots file belongs is not a robots file
            else:
                rp = urllib.robotparser.RobotFileParser()
                rp.parse(text.splitlines())
        elif state == EMPTY and status == 200:
            state = OK  # a short or empty robots file is still a robots file (not an error page)
            rp = urllib.robotparser.RobotFileParser()
            rp.parse(body.decode("utf-8", "replace").splitlines())
        elif state == HTTP_ERROR and status == 404:
            state = OK  # no robots file: allowed, but our own delay and budget still apply
        self._robots[origin] = rp
        return rp, state


# ---- state --------------------------------------------------------------------------------------------------------

SCHEMA = """
CREATE TABLE IF NOT EXISTS hosts(host TEXT PRIMARY KEY, state TEXT, last_state_at TEXT, bad_runs INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS items(source_id TEXT, item_key TEXT, url TEXT, title TEXT, content_sha256 TEXT,
  first_seen TEXT, last_seen TEXT, last_changed TEXT, PRIMARY KEY(source_id, item_key));
CREATE TABLE IF NOT EXISTS runs(ts TEXT, committed INTEGER, requests INTEGER, summary TEXT);
"""


def open_state(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(path))
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(SCHEMA)
    return con


def item_key(url: str) -> str:
    p = urllib.parse.urlparse(url)
    return f"{p.netloc}{p.path}?{p.query}".rstrip("?")


def diff_items(con: sqlite3.Connection, source_id: str, items: list[dict]) -> list[dict]:
    """Annotate items with state new|changed|same against saved rows (read-only)."""
    out = []
    for it in items:
        row = con.execute(
            "SELECT title, content_sha256 FROM items WHERE source_id=? AND item_key=?",
            (source_id, item_key(it["url"])),
        ).fetchone()
        st = "new" if row is None else ("changed" if row[1] != it["content_sha256"] else "same")
        out.append({**it, "state": st})
    return out


def save_items(con: sqlite3.Connection, source_id: str, items: list[dict], now: str) -> None:
    for it in items:
        k = item_key(it["url"])
        if it["state"] == "new":
            con.execute(
                "INSERT OR REPLACE INTO items VALUES(?,?,?,?,?,?,?,?)",
                (source_id, k, it["url"], it["title"], it["content_sha256"], now, now, now),
            )
        elif it["state"] == "changed":
            con.execute(
                "UPDATE items SET title=?, content_sha256=?, last_seen=?, last_changed=? WHERE source_id=? AND item_key=?",
                (it["title"], it["content_sha256"], now, now, source_id, k),
            )
        else:
            con.execute(
                "UPDATE items SET last_seen=? WHERE source_id=? AND item_key=?", (now, source_id, k)
            )


# ---- running a source ---------------------------------------------------------------------------------------------


def load_config(path: Path) -> dict:
    cfg = json.loads(path.read_text(encoding="utf-8"))
    for s in cfg["sources"]:
        if urllib.parse.urlparse(s["list_urls"][0]).scheme != "https":
            raise SystemExit(f"{s['id']}: list_urls must be https")
        if s.get(
            "ca_file"
        ):  # extra intermediate CA for a host that omits it; verification stays ON
            ca = Path(s["ca_file"])
            s["ca_file"] = str(ca if ca.is_absolute() else path.parent / ca)
            if not Path(s["ca_file"]).is_file():
                raise SystemExit(f"{s['id']}: ca_file not found")
    return cfg


def run_source(src: dict, client: Client, con: sqlite3.Connection, details: int = 0) -> dict:
    """Fetch the list pages of one source; returns a report dict. No state writes here."""
    sid = src["id"]
    rep: dict = {
        "source": sid,
        "host": urllib.parse.urlparse(src["list_urls"][0]).netloc,
        "pages": [],
        "items": [],
        "host_state": OK,
        "notes": [],
    }
    ca = src.get("ca_file")
    origin = "https://" + rep["host"]
    if src.get("tls_max"):
        client.tls_max[rep["host"]] = src["tls_max"]
    try:
        rp, st = client.robots(origin, ca)
        if st != OK:
            rep["host_state"] = st
            rep["notes"].append(
                f"robots.txt page state: {st}" + client.last_reason.get(rep["host"], "")
            )
            return rep
        include = re.compile(src["link_regex"]) if src.get("link_regex") else None
        items: dict[str, dict] = {}
        for url in src["list_urls"]:
            if rp is not None and not rp.can_fetch(USER_AGENT, url):
                rep["notes"].append("disallowed by robots.txt: " + urllib.parse.urlparse(url).path)
                continue
            state, status, hdrs, body, final = client.fetch(url, ca)
            rep["pages"].append(
                {
                    "url": url,
                    "state": state,
                    "status": status,
                    "bytes": len(body),
                    **({"reason": hdrs.get("reason")} if state in (TLS_ERROR, NET_ERROR) else {}),
                }
            )
            if state != OK:
                rep["host_state"] = state
                if state in NON_OK_STOPS_HOST:
                    break
                continue
            page = extract_page(body, final)
            if len(page["links"]) < 3:
                rep["notes"].append(
                    "few links: page may need JavaScript (not handled in the pilot)"
                )
            for ln in page["links"]:
                if (
                    urllib.parse.urlparse(ln["url"]).netloc.split(":")[0]
                    != rep["host"].split(":")[0]
                ):
                    continue
                if include and not include.search(ln["url"]) and not include.search(ln["title"]):
                    continue
                if rp is not None and not rp.can_fetch(USER_AGENT, ln["url"]):
                    continue  # robots.txt disallowed path: never stored, never fetched
                if ln["title"]:
                    items.setdefault(
                        ln["url"],
                        {
                            "url": ln["url"],
                            "title": ln["title"],
                            "content_sha256": sha256_text(ln["title"] + " " + ln["url"]),
                        },
                    )
        listed = diff_items(con, sid, list(items.values()))
        for it in [i for i in listed if i["state"] != "same"][
            : max(details, 0)
        ]:  # optional detail fetch, bounded
            if rp is not None and not rp.can_fetch(USER_AGENT, it["url"]):
                continue
            state, _s, _h, body, final = client.fetch(it["url"], ca)
            if state == OK:
                pg = extract_page(body, final)
                it["content_sha256"] = sha256_text(pg["text"])
                it["text"] = pg["text"][:20_000]
                it["page_title"] = pg["title"]
            else:
                it["detail_state"] = state
        rep["items"] = diff_items(con, sid, listed)
    except Skip as exc:
        rep["host_state"] = "skipped"
        rep["notes"].append(str(exc))
    return rep


def to_record(src: dict, it: dict, now: str) -> dict:
    """Staged-row contract of iran_relay.py plus content_sha256/state; rows are always proposed + needs_review."""
    return {
        "source": src["id"],
        "source_tier": src.get("tier", "unofficial"),
        "url": it["url"],
        "doc_id": item_key(it["url"]),
        "title": it.get("page_title") or it["title"],
        "doc_type": src.get("doc_type", "unknown"),
        "number": None,
        "date": None,
        "issuer": src.get("issuer"),
        "text": it.get("text", ""),
        "fetched_at": now,
        "staging_status": "proposed",
        "needs_review": True,
        "content_sha256": it["content_sha256"],
        "state": it["state"],
    }


def summarise(reports: list[dict]) -> str:
    lines = [
        "| source | host state | pages | items | new | changed | notes |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in reports:
        n = sum(1 for i in r["items"] if i["state"] == "new")
        c = sum(1 for i in r["items"] if i["state"] == "changed")
        pg = ", ".join(f"{p['state']}/{p['status']}" for p in r["pages"]) or "-"
        lines.append(
            f"| {r['source']} | {r['host_state']} | {pg} | {len(r['items'])} | {n} | {c} | {'; '.join(r['notes'])[:120]} |"
        )
    return "\n".join(lines)


def cmd_run(a) -> int:
    cfg = load_config(Path(a.config))
    state_dir = Path(
        os.environ.get("SOURCE_WATCHER_STATE", Path.home() / ".local/state/roxira-source-watcher")
    )
    con = open_state(state_dir / "state.db")
    client = Client(
        delay=cfg.get("delay_s", MIN_DELAY),
        max_requests=a.max_requests or cfg.get("max_requests_per_run", 40),
    )
    now = dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    reports = []
    for src in cfg["sources"]:
        if a.only and src["id"] not in a.only:
            continue
        if not src.get("enabled", True) and not a.only:
            continue
        reports.append(run_source(src, client, con, a.details))
    text = summarise(reports)
    print(text)
    print(
        f"\nrequests: {client.requests}  mode: {'COMMIT' if a.commit else 'DRY-RUN (no state or staged rows written)'}"
    )
    rdir = state_dir / "reports"
    rdir.mkdir(parents=True, exist_ok=True)
    (rdir / f"report_{now.replace(':', '')}.json").write_text(
        json.dumps(reports, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    if a.commit:
        out = state_dir / "staged" / f"watcher_{now[:10]}.jsonl"
        out.parent.mkdir(parents=True, exist_ok=True)
        by_id = {s["id"]: s for s in cfg["sources"]}
        ok_reports = [r for r in reports if r["host_state"] == OK]
        lines = [
            json.dumps(to_record(by_id[r["source"]], it, now), ensure_ascii=False)
            for r in ok_reports
            for it in r["items"]
            if it["state"] != "same"
        ]
        # Order matters: staged rows first (flushed + fsynced), DB state last. A crash in between
        # re-emits the rows on the next run (at-least-once; consumers dedupe on doc_id + content_sha256)
        # instead of marking items as seen that were never staged.
        if lines:
            with out.open("a", encoding="utf-8") as fh:
                fh.write("\n".join(lines) + "\n")
                fh.flush()
                os.fsync(fh.fileno())
        try:
            for r in reports:
                con.execute(
                    "INSERT INTO hosts VALUES(?,?,?,?) ON CONFLICT(host) DO UPDATE SET state=excluded.state, "
                    "last_state_at=excluded.last_state_at, bad_runs=CASE WHEN excluded.state='ok' THEN 0 ELSE bad_runs+1 END",
                    (r["host"], r["host_state"], now, 0 if r["host_state"] == OK else 1),
                )
            for r in ok_reports:
                save_items(con, r["source"], r["items"], now)
            con.execute("INSERT INTO runs VALUES(?,?,?,?)", (now, 1, client.requests, text[:2000]))
            con.commit()
        except BaseException:
            con.rollback()
            raise
    return 0


def cmd_status(a) -> int:
    state_dir = Path(
        os.environ.get("SOURCE_WATCHER_STATE", Path.home() / ".local/state/roxira-source-watcher")
    )
    con = open_state(state_dir / "state.db")
    for row in con.execute("SELECT host, state, last_state_at, bad_runs FROM hosts ORDER BY host"):
        print(*row, sep="\t")
    for row in con.execute("SELECT source_id, COUNT(*) FROM items GROUP BY source_id"):
        print("items", *row, sep="\t")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--config", default=str(DEFAULT_CONFIG))
    r.add_argument("--only", nargs="*")
    r.add_argument("--commit", action="store_true")
    r.add_argument(
        "--details", type=int, default=0, help="fetch up to N new/changed item pages per source"
    )
    r.add_argument("--max-requests", type=int, default=0)
    sub.add_parser("status")
    c = sub.add_parser("classify")
    c.add_argument("file")
    a = ap.parse_args(argv)
    if a.cmd == "run":
        return cmd_run(a)
    if a.cmd == "status":
        return cmd_status(a)
    print(classify_page(200, {}, Path(a.file).read_bytes()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
