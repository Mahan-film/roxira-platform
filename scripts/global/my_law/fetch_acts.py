#!/usr/bin/env python3
# ruff: noqa: E501
"""Polite fetcher for the official Malaysian Act PDFs (INTERNAL EVALUATION ONLY).

Reads acts.yaml, fetches each Act that has a ``url`` and records sha256 + fetch date +
source URL in a manifest.

Rules enforced in code (see README.md):
  * robots.txt is read first with urllib.robotparser logic. A disallowed URL is refused.
    If robots.txt cannot be read (network error, HTTP 401/403/5xx) the run refuses unless
    ``--robots-unreadable-ok`` is passed explicitly. HTTP 404 means "no robots.txt"
    (RFC 9309: everything allowed).
  * at most one request per 10 seconds (robots.txt counts; a larger Crawl-delay wins;
    ``--delay`` cannot go below 10);
  * the User-Agent carries a contact taken from env ROXIRA_FETCH_CONTACT (required);
  * no retries and no bypassing. On HTTP 403/429/503, a challenge/captcha page or any
    non-PDF answer the run STOPS and reports (exit code 3);
  * redirects to another host are refused;
  * files are cached under /var/lib/roxira-global/my_law/raw/ and an already cached file
    with a manifest entry is not requested again (``--refresh`` to override).

Stdlib + PyYAML. Network is injectable (``opener``, ``sleep``, ``clock``) so tests run offline.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse
from urllib.robotparser import RobotFileParser

HERE = Path(__file__).resolve().parent
DEFAULT_ACTS = HERE / "acts.yaml"
DEFAULT_OUT = Path("/var/lib/roxira-global/my_law/raw")
CONTACT_ENV = "ROXIRA_FETCH_CONTACT"
MIN_DELAY = 10.0
TIMEOUT = 60
MAX_BYTES = 200 * 1024 * 1024
STOP_STATUSES = frozenset({403, 429, 503})
CHALLENGE_MARKERS = (
    b"captcha",
    b"just a moment",
    b"cf-chl",
    b"cf-browser-verification",
    b"attention required",
    b"are you a robot",
    b"access denied",
    b"challenge-platform",
)
EXIT_OK, EXIT_ERROR, EXIT_REFUSED, EXIT_STOPPED = 0, 1, 2, 3


class Refusal(Exception):
    """Refused before or without fetching (robots, config)."""


class Stopped(Exception):
    """A block/challenge was seen: stop the whole run, no retry."""


def user_agent(env: dict[str, str] | None = None) -> str:
    contact = (env if env is not None else os.environ).get(CONTACT_ENV, "").strip()
    if not contact:
        raise Refusal(f"refused: set env {CONTACT_ENV} (an email or URL) for the User-Agent")
    return f"RoxiraResearchBot/1.0 (internal evaluation; contact: {contact})"


def looks_like_challenge(headers: Any, body: bytes) -> bool:
    """True for a captcha / bot-challenge answer (also when it comes with HTTP 200)."""
    if headers is not None:
        if str(headers.get("cf-mitigated", "")).lower() == "challenge":
            return True
    if body.startswith(b"%PDF"):
        return False
    low = body[:20000].lower()
    return any(m in low for m in CHALLENGE_MARKERS)


class _SameHostRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlparse(newurl).hostname != urlparse(req.full_url).hostname:
            raise Stopped(f"refused cross-host redirect to {urlparse(newurl).hostname}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def default_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(_SameHostRedirect)


class Fetcher:
    def __init__(self, ua: str, *, delay: float = MIN_DELAY, opener=None, sleep=time.sleep,
                 clock=time.monotonic) -> None:
        self.ua = ua
        self.delay = max(float(delay), MIN_DELAY)
        self.opener = opener or default_opener()
        self._sleep = sleep
        self._clock = clock
        self._last: float | None = None

    def _wait(self) -> None:
        if self._last is not None:
            gap = self.delay - (self._clock() - self._last)
            if gap > 0:
                self._sleep(gap)
        self._last = self._clock()

    def get(self, url: str, max_bytes: int = MAX_BYTES) -> tuple[int, Any, bytes]:
        """One rate-limited GET. Returns (status, headers, body). 4xx/5xx are returned, not raised."""
        self._wait()
        req = urllib.request.Request(url, headers={"User-Agent": self.ua, "Accept": "*/*"})
        try:
            with self.opener.open(req, timeout=TIMEOUT) as resp:
                return resp.status, resp.headers, resp.read(max_bytes + 1)
        except urllib.error.HTTPError as err:
            try:
                return err.code, err.headers, err.read(65536)
            finally:
                err.close()

    def robots_for(self, url: str, *, unreadable_ok: bool) -> tuple[RobotFileParser | None, str]:
        """Return (parser or None, note). None means unreadable but explicitly accepted."""
        p = urlparse(url)
        robots_url = urlunparse((p.scheme, p.netloc, "/robots.txt", "", "", ""))
        try:
            status, _h, body = self.get(robots_url, max_bytes=1024 * 1024)
        except Stopped:
            raise
        except (urllib.error.URLError, OSError, TimeoutError) as err:
            return self._unreadable(f"robots.txt unreadable ({type(err).__name__})", unreadable_ok)
        if status == 404:
            rp = RobotFileParser()
            rp.parse([])
            return rp, "robots.txt absent (HTTP 404): all allowed per RFC 9309"
        if status != 200:
            return self._unreadable(f"robots.txt unreadable (HTTP {status})", unreadable_ok)
        rp = RobotFileParser()
        rp.parse(body.decode("utf-8", "replace").splitlines())
        return rp, "robots.txt read"

    @staticmethod
    def _unreadable(note: str, ok: bool) -> tuple[None, str]:
        if not ok:
            raise Refusal(f"refused: {note}; pass --robots-unreadable-ok only after the hub checked the site terms")
        return None, note + " (continuing because --robots-unreadable-ok was passed)"


def load_acts(path: Path) -> list[dict]:
    import yaml

    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    pattern = data.get("url_pattern")
    acts = []
    for a in data.get("acts", []):
        a = dict(a)
        if not a.get("url") and pattern:
            a["url"] = str(pattern).format(act_no=a["act_no"])
        acts.append(a)
    return acts


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def load_manifest(path: Path) -> dict:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"schema_version": 1, "files": {}}


def save_manifest(path: Path, manifest: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def run(args: argparse.Namespace, *, fetcher: Fetcher | None = None, env: dict | None = None) -> int:
    acts = [a for a in load_acts(args.acts) if not args.only or str(a["act_no"]) in args.only]
    todo = [a for a in acts if a.get("url")]
    skipped = [a for a in acts if not a.get("url")]
    for a in skipped:
        print(f"skip Act {a['act_no']} {a['title']}: url is null in acts.yaml")
    if not todo:
        print("nothing to fetch (no Act has a url)")
        return EXIT_OK
    if args.dry_run:
        for a in todo:
            print(f"would fetch Act {a['act_no']} {a['title']} <- {a['url']}")
        return EXIT_OK
    try:
        fetcher = fetcher or Fetcher(user_agent(env), delay=args.delay)
        hosts = {urlparse(a["url"]).scheme + "://" + urlparse(a["url"]).netloc for a in todo}
        robots: dict[str, RobotFileParser | None] = {}
        for h in sorted(hosts):
            robots[h], note = fetcher.robots_for(h + "/", unreadable_ok=args.robots_unreadable_ok)
            print(f"{h}: {note}")
            delay = robots[h].crawl_delay(fetcher.ua) if robots[h] else None
            if delay and float(delay) > fetcher.delay:
                fetcher.delay = float(delay)
    except Refusal as err:
        print(str(err), file=sys.stderr)
        return EXIT_REFUSED
    except Stopped as err:
        print(f"STOPPED: {err}", file=sys.stderr)
        return EXIT_STOPPED

    args.out.mkdir(parents=True, exist_ok=True)
    mpath = args.out / "manifest.json"
    manifest = load_manifest(mpath)
    failures = 0
    for a in todo:
        url, key = a["url"], f"act_{a['act_no']}.pdf"
        dest = args.out / key
        rp = robots[urlparse(url).scheme + "://" + urlparse(url).netloc]
        if rp is not None and not rp.can_fetch(fetcher.ua, url):
            print(f"REFUSED by robots.txt: {url}", file=sys.stderr)
            return EXIT_REFUSED
        if dest.exists() and key in manifest["files"] and not args.refresh:
            print(f"cached Act {a['act_no']} ({key}), not requested")
            continue
        try:
            status, headers, body = fetcher.get(url)
            if status in STOP_STATUSES or looks_like_challenge(headers, body):
                raise Stopped(f"HTTP {status} / challenge or block for Act {a['act_no']} ({url}); not retrying")
            if status != 200:
                print(f"FAILED Act {a['act_no']}: HTTP {status}", file=sys.stderr)
                failures += 1
                continue
            if not body.startswith(b"%PDF") or len(body) > MAX_BYTES:
                raise Stopped(f"answer for Act {a['act_no']} is not a PDF (or too large); not retrying")
        except Stopped as err:
            save_manifest(mpath, manifest)
            print(f"STOPPED: {err}", file=sys.stderr)
            return EXIT_STOPPED
        except (urllib.error.URLError, OSError, TimeoutError) as err:
            print(f"FAILED Act {a['act_no']}: {type(err).__name__}", file=sys.stderr)
            failures += 1
            continue
        dest.write_bytes(body)
        manifest["files"][key] = {
            "act_no": a["act_no"],
            "title": a["title"],
            "source_url": url,
            "sha256": sha256_bytes(body),
            "bytes": len(body),
            "fetched_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "http_status": status,
        }
        save_manifest(mpath, manifest)
        print(f"fetched Act {a['act_no']} -> {dest} sha256={manifest['files'][key]['sha256'][:12]}")
    save_manifest(mpath, manifest)
    return EXIT_ERROR if failures else EXIT_OK


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--acts", type=Path, default=DEFAULT_ACTS)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--only", nargs="*", default=[], help="Act numbers to fetch")
    ap.add_argument("--delay", type=float, default=MIN_DELAY, help="seconds between requests (minimum 10)")
    ap.add_argument("--refresh", action="store_true", help="re-fetch files that are already cached")
    ap.add_argument("--dry-run", action="store_true", help="list what would be fetched; no network")
    ap.add_argument("--robots-unreadable-ok", action="store_true",
                    help="continue when robots.txt cannot be read (hub decision only)")
    return run(ap.parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())
