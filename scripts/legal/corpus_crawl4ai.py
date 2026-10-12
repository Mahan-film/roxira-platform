#!/usr/bin/env python3
"""crawl4ai engine for the corpus gap fill (repeatable; deterministic parsing, no LLM, no Qdrant/DB writes).

  corpus_crawl4ai.py fetch    --out DIR [--only ID ...]   crawl the URLs listed under "crawl4ai.urls" of each law
                                in config/corpus_fill_laws.json with crawl4ai (headless chromium), one request per
                                >= 2 s per host, robots.txt honoured, 403/429/CAPTCHA/JS-challenge => the URL (and
                                that host for the rest of the run) is left alone, never bypassed. Writes
                                DIR/<id>.txt + DIR/manifest.json (same shape as fetch_laws.py output).
  corpus_crawl4ai.py stage    --fetched DIR --out FILE.jsonl [--only ID ...] [--allow-proposed]
                                parse into article rows with scripts/legal/corpus_fill.py (same schema/normalisation),
                                write ONE jsonl (+ .repealed.jsonl), run the ingest gates and the checks below.
  corpus_crawl4ai.py validate FILE.jsonl                  gaps / HTML junk / normalisation / duplicates report
  corpus_crawl4ai.py sample   FILE.jsonl [--n 5] [--seed 7]   random articles per law for manual comparison with the source

OPTIONAL path: the four 2026-10-12 laws are fetched from ekhtebar.ir (owner's only accepted source) by
scripts/legal/fetch_ekhtebar_wp.py, which `corpus_fill.py fetch-laws` now uses by default. This crawl4ai engine stays
available for other sites (put their URLs under "crawl4ai.urls" in the config); it is not needed for the four laws.

Setup (owner/hub machine with PyPI access):
  python3 -m venv .venv-crawl && .venv-crawl/bin/pip install crawl4ai && .venv-crawl/bin/crawl4ai-setup
Rows stay UNVERIFIED (needs_review); the allowlist entries are status "proposed", so ingest needs --allow-proposed.
Output of `fetch` goes OUTSIDE the repo (raw pages); only the staged jsonl lives under data/legal/staged/.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import random
import re
import sys
import time
import urllib.error
import urllib.request
import urllib.robotparser
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
USER_AGENT = "RoxiraLegalResearchBot/1.0 (+owner-run, low-rate, robots.txt honoured)"
MIN_DELAY = 2.0
BLOCK_MARKERS = (
    "captcha", "cf-chl", "cf-browser-verification", "Just a moment", "Access Denied",
    "Attention Required", "Transferring to the website", "در حال انتقال به سایت",
    "در ﺣﺎل اﻧﺘﻘﺎل",
)  # fmt: skip
DEFAULT_CONFIG = ROOT / "config/corpus_fill_laws.json"
DEFAULT_ALLOWLIST = ROOT / "config/legal_allowlist.json"
HTML_JUNK_RE = re.compile(
    r"<\/?[a-zA-Z][^>]*>|&[a-z]+;|&#\d+;|https?://|www\.|\bclass=|\bhref=|برچسب|ارسال دیدگاه|"
    r"دسته ?بندی|کپی لینک|\[\]\(|\]\(http|^\s*[#>*]{1,3}\s|\*\*|!\[|دانلود"
)


def _load(name: str, rel: str):
    mod = sys.modules.get(name)
    if mod is None:
        spec = importlib.util.spec_from_file_location(name, ROOT / rel)
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        spec.loader.exec_module(mod)
    return mod


# ----------------------------------------------------------------------------- markdown -> plain law text
def markdown_to_text(md: str) -> str:
    """crawl4ai markdown -> plain lines the corpus_fill parser understands (links/emphasis/images removed)."""
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", md)
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)  # [text](url) -> text
    t = re.sub(r"<[^>]+>", "", t)
    t = t.replace("&nbsp;", " ").replace("&amp;", "&")
    t = re.sub(r"(\*\*|__|`)", "", t)
    t = re.sub(r"^\s{0,3}#{1,6}\s*", "", t, flags=re.M)
    t = re.sub(r"^\s*(?:[-*+]|\d+\.)\s+(?=ماده|تبصره|بند)", "", t, flags=re.M)
    t = re.sub(r"^\s*>\s?", "", t, flags=re.M)
    return t.strip() + "\n"


def looks_blocked(status: int | None, html: str, text: str) -> str | None:
    if status in (401, 403, 429, 451):
        return f"http_{status}"
    if status and status >= 400:
        return f"http_{status}"
    probe = (html[:6000] if html else "") + (text[:2000] if text else "")
    for m in BLOCK_MARKERS:
        if m.lower() in probe.lower():
            return f"block_marker:{m}"
    if len(text.strip()) < 300:
        return "too_little_text"
    return None


# ----------------------------------------------------------------------------- fetch (crawl4ai)
def robots_decision(status: int | None, body: str | None) -> tuple[urllib.robotparser.RobotFileParser | None, bool]:
    """RFC 9309 (2.3.1): returns (parser, allow_all). 2xx => parse the file; 4xx => no robots.txt, everything is
    allowed; 5xx or unreachable (status None) => treat as a complete disallow. An HTML body (JS challenge served
    in place of robots.txt) is unreadable => disallow."""
    if status is not None and 200 <= status < 300 and body is not None:
        if "<html" in body[:500].lower():
            return None, False
        rp = urllib.robotparser.RobotFileParser()
        rp.parse(body.splitlines())
        return rp, False
    if status is not None and 400 <= status < 500:
        return None, True
    return None, False


def _fetch_robots_blocking(url: str) -> tuple[int | None, str | None]:
    """Blocking robots.txt download. Only ever called through asyncio.to_thread (never on the event loop)."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310 - https only, allow-listed hosts
            return r.status, r.read(200_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, None
    except Exception:  # noqa: BLE001 - network error => unreachable
        return None, None


class Politeness:
    def __init__(self, delay: float = MIN_DELAY):
        self.delay = max(delay, MIN_DELAY)
        self.last: dict[str, float] = {}
        self.robots: dict[str, tuple[urllib.robotparser.RobotFileParser | None, bool]] = {}
        self.dead_hosts: set[str] = set()

    async def wait(self, host: str) -> None:
        gap = time.monotonic() - self.last.get(host, 0.0)
        if gap < self.delay:
            await asyncio.sleep(self.delay - gap)
        self.last[host] = time.monotonic()

    async def allowed(self, url: str) -> tuple[bool, str]:
        u = urlparse(url)
        host = u.netloc
        if host in self.dead_hosts:
            return False, "host_blocked_earlier"
        if host not in self.robots:
            await self.wait(host)
            status, body = await asyncio.to_thread(_fetch_robots_blocking, f"{u.scheme}://{host}/robots.txt")
            self.robots[host] = robots_decision(status, body)
        rp, allow_all = self.robots[host]
        if allow_all:
            return True, "robots_absent_allow_all"
        if rp is None:
            return False, "robots_unreadable"
        return (rp.can_fetch(USER_AGENT, url), "robots_disallow")


async def _crawl(urls: list[tuple[str, str]], pol: Politeness) -> dict[str, dict]:
    try:
        from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig
    except ImportError as exc:  # pragma: no cover
        raise SystemExit("crawl4ai is not installed: python3 -m venv .venv-crawl && .venv-crawl/bin/pip install crawl4ai && .venv-crawl/bin/crawl4ai-setup") from exc
    out: dict[str, dict] = {}
    bcfg = BrowserConfig(headless=True, user_agent=USER_AGENT, verbose=False)
    rcfg = CrawlerRunConfig(cache_mode=CacheMode.BYPASS, page_timeout=60_000, wait_until="domcontentloaded")
    async with AsyncWebCrawler(config=bcfg) as crawler:
        for law_id, url in urls:
            host = urlparse(url).netloc
            ok, why = await pol.allowed(url)
            if not ok:
                out[url] = {"law_id": law_id, "status": "refused", "reason": why}
                continue
            await pol.wait(host)
            try:
                res = await crawler.arun(url=url, config=rcfg)
            except Exception as exc:  # noqa: BLE001
                out[url] = {"law_id": law_id, "status": "error", "reason": type(exc).__name__}
                continue
            md = getattr(res.markdown, "raw_markdown", None) or str(res.markdown or "")
            text = markdown_to_text(md)
            blocked = looks_blocked(getattr(res, "status_code", None), getattr(res, "html", "") or "", text)
            if blocked:
                pol.dead_hosts.add(host)  # never retry / work around
                out[url] = {"law_id": law_id, "status": "blocked", "reason": blocked}
                continue
            out[url] = {"law_id": law_id, "status": "done", "text": text}
    return out


def cmd_fetch(args) -> int:
    cfg = json.loads(args.config.read_text(encoding="utf-8"))
    fl = _load("fetch_laws", "scripts/legal/fetch_laws.py")
    outdir = fl.fe.assert_outside_repo(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    allowed = set(cfg.get("allowed_domains", []))
    jobs, laws = [], {}
    for law in cfg["laws"]:
        urls = (law.get("crawl4ai") or {}).get("urls") or []
        if (args.only and law["id"] not in args.only) or (not args.only and not urls):
            continue  # without --only: just the laws that have crawl4ai URLs
        laws[law["id"]] = {"urls": urls}
        for u in urls:
            host = urlparse(u).netloc.removeprefix("www.")
            if host not in allowed:
                print(f"skip (domain not allow-listed): {u}")
                continue
            jobs.append((law["id"], u))
    results = asyncio.run(_crawl(jobs, Politeness(args.delay)))
    manifest: dict[str, dict] = {}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for law_id, info in laws.items():
        texts, attempts, used = [], [], []
        for u in info["urls"]:
            r = results.get(u, {"status": "skipped"})
            attempts.append({"url": u, "status": r["status"], "reason": r.get("reason")})
            if r["status"] == "done":
                texts.append(r["text"])
                used.append(u)
        if texts:
            (outdir / f"{law_id}.txt").write_text("\n\n".join(texts), encoding="utf-8")
            manifest[law_id] = {
                "status": "done", "kind": "text", "file": f"{law_id}.txt", "source_url": used[0],
                "source_urls": used, "source": "crawl4ai", "source_label": urlparse(used[0]).netloc,
                "fetched_at": now, "attempts": attempts,
            }  # fmt: skip
        else:
            manifest[law_id] = {"status": "failed", "attempts": attempts}
    (outdir / "manifest.json").write_text(json.dumps({"laws": manifest}, ensure_ascii=False, indent=2), encoding="utf-8")
    for k, v in manifest.items():
        print(k, v["status"], [(a["status"], a["reason"]) for a in v["attempts"]])
    return 0 if all(v["status"] == "done" for v in manifest.values()) else 4


# ----------------------------------------------------------------------------- stage
def cmd_stage(args) -> int:
    cf = _load("corpus_fill", "scripts/legal/corpus_fill.py")
    ing = cf._load_ingest()
    cfg = json.loads(args.config.read_text(encoding="utf-8"))
    manifest = json.loads((args.fetched / "manifest.json").read_text(encoding="utf-8"))["laws"]
    allowlist = ing.load_allowlist(args.allowlist, allow_proposed=args.allow_proposed)
    rows, repealed, report = [], [], {}
    for law in cfg["laws"]:
        if (args.only and law["id"] not in args.only) or (not args.only and law["id"] not in manifest):
            continue  # without --only: just the laws that were fetched
        ent = manifest.get(law["id"])
        if not ent or ent.get("status") != "done":
            report[law["id"]] = {"skipped": "not_fetched"}
            continue
        text = (args.fetched / ent["file"]).read_text(encoding="utf-8")
        res = cf.stage_law(law, text, ent, allowlist)
        fetched_at = ent.get("fetched_at")
        for r in res["rows"] + res["repealed_rows"]:
            r["fetched_at"] = fetched_at
            r["source"] = "crawl4ai"
        rows += res["rows"]
        repealed += res["repealed_rows"]
        report[law["id"]] = {"rows": len(res["rows"]), "repealed_excluded": len(res["repealed_rows"]),
                             "analysis": res["analysis"], "gates": res.get("gates")}  # fmt: skip
    print(json.dumps(report, ensure_ascii=False, indent=2))
    empty = [k for k, v in report.items() if not v.get("rows")]  # includes "skipped: not_fetched"
    if empty:
        print(f"ERROR: selected law(s) with 0 rows: {empty}; nothing written", file=sys.stderr)
        return 5
    cf.write_jsonl(args.out, rows)
    if repealed:
        cf.write_jsonl(args.out.with_suffix(".repealed.jsonl"), repealed)
    problems = validate_rows(rows + repealed)
    print(json.dumps(problems, ensure_ascii=False, indent=2))
    return 0 if not problems["html_junk"] and not problems["not_normalised"] else 3


# ----------------------------------------------------------------------------- validate / sample
def validate_rows(rows: list[dict]) -> dict:
    cf = _load("corpus_fill", "scripts/legal/corpus_fill.py")
    by_law: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_law[r["law_name"]].append(r)
    rep: dict = {"per_law": {}, "html_junk": [], "not_normalised": [], "duplicate_keys": []}
    for law, rs in by_law.items():
        nums = sorted({int(r["article_no"].split("-")[0]) for r in rs if r["article_no"].split("-")[0].isdigit()})
        gaps = [n for n in range(nums[0], nums[-1] + 1) if n not in set(nums)] if nums else []
        rep["per_law"][law] = {"rows": len(rs), "first": nums[0] if nums else None, "last": nums[-1] if nums else None,
                               "gaps": gaps, "repealed": sum(1 for r in rs if not r["is_active"])}  # fmt: skip
        keys = [r["article_no"] + "|" + r["article_label"] for r in rs]
        rep["duplicate_keys"] += sorted({k for k in keys if keys.count(k) > 1})
    for r in rows:
        if HTML_JUNK_RE.search(r["text"]):
            rep["html_junk"].append(r["article_label"] + " / " + r["law_name"])
        if cf.normalise_text(r["text"]) != r["text"]:
            rep["not_normalised"].append(r["article_label"] + " / " + r["law_name"])
    return rep


def cmd_validate(args) -> int:
    rows = [json.loads(ln) for ln in args.file.read_text(encoding="utf-8").splitlines() if ln.strip()]
    rep = validate_rows(rows)
    print(json.dumps(rep, ensure_ascii=False, indent=2))
    return 0 if not rep["html_junk"] and not rep["not_normalised"] else 3


def cmd_sample(args) -> int:
    rows = [json.loads(ln) for ln in args.file.read_text(encoding="utf-8").splitlines() if ln.strip()]
    rnd = random.Random(args.seed)
    by_law: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_law[r["law_name"]].append(r)
    for law, rs in by_law.items():
        print(f"\n== {law} ({len(rs)} rows)")
        for r in rnd.sample(rs, min(args.n, len(rs))):
            print(f"- {r['article_label']} | {r['source_url']}\n  {r['text'][:300]!r}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch")
    f.add_argument("--out", type=Path, required=True)
    f.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    f.add_argument("--only", nargs="*")
    f.add_argument("--delay", type=float, default=MIN_DELAY)
    s = sub.add_parser("stage")
    s.add_argument("--fetched", type=Path, required=True)
    s.add_argument("--out", type=Path, required=True)
    s.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    s.add_argument("--allowlist", type=Path, default=DEFAULT_ALLOWLIST)
    s.add_argument("--only", nargs="*")
    s.add_argument("--allow-proposed", action="store_true")
    v = sub.add_parser("validate")
    v.add_argument("file", type=Path)
    sm = sub.add_parser("sample")
    sm.add_argument("file", type=Path)
    sm.add_argument("--n", type=int, default=5)
    sm.add_argument("--seed", type=int, default=7)
    args = ap.parse_args(argv)
    return {"fetch": cmd_fetch, "stage": cmd_stage, "validate": cmd_validate, "sample": cmd_sample}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
