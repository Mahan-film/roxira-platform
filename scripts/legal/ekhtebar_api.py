#!/usr/bin/env python3
r"""ekhtebar.ir (WordPress REST) reader -> NEW staged JSONL rows + Markdown report.

ekhtebar.ir / ekhtebar.com is the owner-approved UNOFFICIAL legal source. This reader uses the public
WordPress REST API the site exposes (checked 2026-10-22):

  /wp-json/wp/v2/posts?search=<q>&per_page=100&page=N&_fields=id,link,title,date,modified,content,tags,categories
  /wp-json/wp/v2/tags?search=<q>        /wp-json/wp/v2/categories        (paging: X-WP-TotalPages header)

Commands (all write a NEW file, never touch an existing one):
  tag <slug-or-name> [--max-pages N]      every post of a tag -> rows
  category <slug> [--max-pages N]         every post of a category -> rows
  search "<query>" [--limit N]            every post matching a query -> rows
  gaps --corpus-laws <file> [--tag ...]   posts whose normalised title is NOT a corpus law name -> rows

The article splitting and the row schema are exactly scripts/legal/sync_sources.py's (parse_law_page /
write_new_jsonl / norm_name are reused, never copied). Every row is `source_label: "ekhtebar.ir"`,
`source_tier: "unofficial"`, `staging_status: "proposed"`, `needs_review: true`, carries the post
`source_url`, `retrieved_at` and the post `modified` date. A whole-post repealed page yields no active rows.

Corpus law-name list for `gaps`: regenerated from data/legal/*.jsonl by
  python3 scripts/legal_coverage_report.py --data-dir data/legal --json-out /tmp/coverage_manifest.json
then flattened to one name per line
  python3 -c "import json;print('\n'.join(l['name'] for l in json.load(open('/tmp/coverage_manifest.json'))['laws']))" \
      > /tmp/corpus_laws.txt
and passed as `gaps --corpus-laws /tmp/corpus_laws.txt` (the manifest JSON file itself is also accepted).

Output (all NEW files; data/ is never modified in place):
  data/legal/staged/ekhtebar_api_<kind>_<YYYY-MM-DD>.jsonl   proposed rows
  data/legal/staged/ekhtebar_api_<kind>_<YYYY-MM-DD>.md      short Markdown report

Politeness: User-Agent «RoxiraBot/1.0 (+https://ghazihoushmand.ir)», robots.txt honoured (RFC 9309),
>= 2 s between requests, per-run budget (default 1500 requests), retries with backoff on 429/5xx, and a
challenge/CAPTCHA page STOPS the run - it is never solved or bypassed. Stdlib + certifi.
"""

from __future__ import annotations

import argparse
import gzip
import html
import http.client
import importlib.util
import json
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = "https://www.ekhtebar.com"
SITE_HOSTS = frozenset({"ekhtebar.com", "www.ekhtebar.com", "ekhtebar.ir", "www.ekhtebar.ir"})
USER_AGENT = "RoxiraBot/1.0 (+https://ghazihoushmand.ir)"
MIN_DELAY = 2.0
DEFAULT_MAX_REQUESTS = 1500
PER_PAGE = 100
MAX_REDIRECTS = 5
SOURCE_LABEL = "ekhtebar.ir"
POST_FIELDS = "id,link,title,date,modified,content,tags,categories"
TAXONOMY_FIELDS = "id,name,slug"
# the tags the owner named, used by `gaps` when no selector is given
DEFAULT_GAP_TAGS = ("بخشنامه-بانک-مرکزی", "بخشنامه-ثبتی")


class Blocked(Exception):
    """Robots refusal, 401/403/451, challenge/CAPTCHA, or the request budget: the run stops."""


class BudgetExhausted(Blocked):
    """The per-run request budget was reached: a clean stop, not an error."""


class FetchFailed(Exception):
    """Transient/other failure for one URL: it is recorded and the run goes on."""


def _load(name: str, rel: str):
    mod = sys.modules.get(name)
    if mod is None:
        spec = importlib.util.spec_from_file_location(name, ROOT / rel)
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        spec.loader.exec_module(mod)
    return mod


def ss():
    """scripts/legal/sync_sources.py - parser, row schema, normaliser and JSONL writer (reused)."""
    return _load("sync_sources", "scripts/legal/sync_sources.py")


def nz():
    """scripts/legal/fetch_nezamat_wp.py - robots decision helper (reused)."""
    return _load("fetch_nezamat_wp", "scripts/legal/fetch_nezamat_wp.py")


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def rest_url(base: str, path: str, params: dict | None = None) -> str:
    url = base.rstrip("/") + path
    if params:
        url += "?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    return url


def strip_tags(fragment: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", fragment)).strip()


# ----------------------------------------------------------------------------- polite HTTP
class Client:
    """One request / >= 2 s, robots.txt, redirects re-checked per hop, budget, backoff, hard stop."""

    def __init__(self, delay: float = MIN_DELAY, max_requests: int = DEFAULT_MAX_REQUESTS, opener=None,
                 sleep=time.sleep, clock=time.monotonic):  # fmt: skip
        self.delay = max(delay, MIN_DELAY)
        self.max_requests = max_requests
        self.requests = 0
        self._last = 0.0
        self._ctx = None
        self._opener = opener  # test hook: callable(url, headers) -> (status, headers, bytes)
        self._sleep = sleep
        self._clock = clock
        self._robots: dict[str, object] = {}

    def _wait(self) -> None:
        gap = self._clock() - self._last
        if self._last and gap < self.delay:
            self._sleep(self.delay - gap)
        self._last = self._clock()

    def _raw(self, url: str) -> tuple[int, dict, bytes]:
        netloc = urllib.parse.urlparse(url).netloc.lower()
        if netloc not in SITE_HOSTS:
            raise Blocked(f"host not allowed: {netloc}")
        if self.requests >= self.max_requests:
            raise BudgetExhausted(f"request budget ({self.max_requests}) exhausted")
        self._wait()
        self.requests += 1
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "application/json, text/html;q=0.9, */*;q=0.5",
            "Accept-Language": "fa,en;q=0.5",
            "Accept-Encoding": "gzip",
        }
        if self._opener:
            status, hdrs, data = self._opener(url, headers)
        else:
            status, hdrs, data = self._urlopen(url, headers)
        if (hdrs.get("Content-Encoding") or hdrs.get("content-encoding") or "").lower() == "gzip":
            try:
                data = gzip.decompress(data)
            except OSError:
                pass
        return status, hdrs, data

    def _urlopen(self, url: str, headers: dict) -> tuple[int, dict, bytes]:
        if self._ctx is None:
            try:
                import certifi

                self._ctx = ssl.create_default_context(cafile=certifi.where())
            except ImportError:  # pragma: no cover
                self._ctx = ssl.create_default_context()
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, context=self._ctx, timeout=60) as r:
                return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as exc:
            return exc.code, dict(exc.headers or {}), exc.read() or b""

    def check_robots(self, url: str) -> None:
        netloc = urllib.parse.urlparse(url).netloc.lower()
        if netloc not in self._robots:
            try:
                status, _, data = self._raw(f"{urllib.parse.urlparse(url).scheme}://{netloc}/robots.txt")
                self._robots[netloc] = nz().robots_decision(status, data.decode("utf-8", "replace"))
            except (urllib.error.URLError, OSError, http.client.HTTPException):
                self._robots[netloc] = nz().robots_decision(None, None)
        rp, allow_all = self._robots[netloc]  # type: ignore[misc]
        if not allow_all and rp is None:
            raise Blocked(f"robots.txt unreadable/5xx on {netloc}: treated as disallow-all")

    def allowed(self, url: str) -> bool:
        self.check_robots(url)
        rp, allow_all = self._robots[urllib.parse.urlparse(url).netloc.lower()]  # type: ignore[misc]
        return True if allow_all else bool(rp and rp.can_fetch(USER_AGENT, url))

    def get(self, url: str, retries: int = 3) -> tuple[int, dict, bytes]:
        self.check_robots(url)
        final = url
        for _hop in range(MAX_REDIRECTS + 1):
            if not self.allowed(final):
                raise FetchFailed(f"robots.txt disallows {final}")
            status, hdrs, data = self._fetch_with_retries(final, retries)
            if status in (301, 302, 303, 307, 308):
                loc = _hget(hdrs, "location")
                if not loc:
                    raise FetchFailed(f"redirect without Location: {final}")
                final = urllib.parse.urljoin(final, loc)
                continue
            return status, hdrs, data
        raise FetchFailed(f"too many redirects: {url}")

    def _fetch_with_retries(self, url: str, retries: int) -> tuple[int, dict, bytes]:
        last: Exception | None = None
        for attempt in range(retries + 1):
            try:
                status, hdrs, data = self._raw(url)
            except BudgetExhausted:
                raise
            except (http.client.IncompleteRead, http.client.RemoteDisconnected, ConnectionResetError,
                    TimeoutError, urllib.error.URLError, OSError) as exc:  # fmt: skip
                last = exc
                self._sleep(2**attempt)
                continue
            reason = ss().detect_challenge(status, hdrs, data)
            if reason:
                raise Blocked(f"{reason} ({url})")
            if status in (401, 403, 451):
                raise Blocked(f"HTTP {status} ({url})")
            if status == 429 or status >= 500:
                wait = _retry_after(hdrs) or 2**attempt * 5
                last = FetchFailed(f"HTTP {status}")
                self._sleep(min(wait, 120))
                continue
            return status, hdrs, data
        raise FetchFailed(f"{url}: {last}")

    def json(self, url: str) -> tuple[object, dict]:
        status, hdrs, data = self.get(url)
        if status != 200:
            raise FetchFailed(f"{url}: HTTP {status}")
        return json.loads(data), hdrs


def _hget(hdrs: dict, name: str) -> str | None:
    for k, v in hdrs.items():
        if k.lower() == name:
            return v
    return None


def _retry_after(hdrs: dict) -> float | None:
    v = _hget(hdrs, "retry-after")
    try:
        return float(v) if v is not None else None
    except ValueError:
        return None


# ----------------------------------------------------------------------------- REST reads
def list_taxonomy(client: Client, base: str, kind: str, params: dict) -> list[dict]:
    """GET /wp-json/wp/v2/<tags|categories>?... (single page is enough for a lookup)."""
    query = {**params, "per_page": PER_PAGE, "_fields": TAXONOMY_FIELDS}
    data, _ = client.json(rest_url(base, f"/wp-json/wp/v2/{kind}", query))
    return data if isinstance(data, list) else []


def resolve_tag(client: Client, base: str, slug_or_name: str) -> dict | None:
    for params in ({"slug": slug_or_name}, {"search": slug_or_name}):
        items = list_taxonomy(client, base, "tags", params)
        if items:
            return items[0]
    return None


def resolve_category(client: Client, base: str, slug: str) -> dict | None:
    for params in ({"slug": slug}, {"search": slug}):
        items = list_taxonomy(client, base, "categories", params)
        if items:
            return items[0]
    return None


def iter_posts(client: Client, base: str, params: dict, max_pages: int | None = None):
    """Yield posts across pages; WP answers HTTP 400 code rest_post_invalid_page_number past the last page."""
    page = 1
    while max_pages is None or page <= max_pages:
        query = {**params, "per_page": PER_PAGE, "page": page, "_fields": POST_FIELDS}
        url = rest_url(base, "/wp-json/wp/v2/posts", query)
        status, hdrs, data = client.get(url)
        if status == 400:  # past the last page
            return
        if status != 200:
            raise FetchFailed(f"{url}: HTTP {status}")
        items = json.loads(data)
        if not isinstance(items, list) or not items:
            return
        yield from items
        total = int(_hget(hdrs, "x-wp-totalpages") or "1")
        if page >= total:
            return
        page += 1


# ----------------------------------------------------------------------------- rows
def post_to_rows(post: dict, retrieved_at: str) -> dict:
    """Post JSON -> the sync_sources row schema (parse_law_page is reused, not copied)."""
    title = strip_tags((post.get("title") or {}).get("rendered") or "")
    link = post.get("link") or ""
    content = (post.get("content") or {}).get("rendered") or ""
    page = (
        "<html><head><title>" + html.escape(title) + "</title></head><body>"
        "<h1>" + html.escape(title) + "</h1>"
        '<div class="entry-content">' + content + "</div></body></html>"
    )
    parsed = ss().parse_law_page("ekhtebar", link, page)
    lid = f"sync_ekhtebar_{post.get('id')}" if post.get("id") is not None else parsed["law_id"]
    rows = parsed["rows"]
    for r in rows:
        r["law_id"] = lid
        r["source_label"] = ss().HOSTS["ekhtebar"]["source_label"]
        r["source_url"] = link
        r["retrieved_at"] = retrieved_at
        r["modified"] = post.get("modified")
        r["ekhtebar_post_id"] = post.get("id")
    return {"title": title or parsed["title"], "kind": parsed["kind"], "law_id": lid, "rows": rows,
            "repealed": len(parsed["repealed_rows"]), "link": link}  # fmt: skip


def dedupe_rows(rows: list[dict]) -> list[dict]:
    seen: set[tuple] = set()
    out: list[dict] = []
    for r in rows:
        key = (r.get("law_id"), r.get("article_no"), r.get("article_label"))
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


# ----------------------------------------------------------------------------- outputs
def write_report(path: Path, kind: str, date: str, selector: str, posts: int, laws: list[dict],
                 rows: int, repealed: int, requests: int, blocked: str | None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# ekhtebar.ir REST staging ({kind}) {date}", "",
        "Source: `ekhtebar.ir` (UNOFFICIAL, WordPress REST API). Every row is "
        "`staging_status: proposed`, `needs_review: true` and needs a lawyer before ingest.", "",
        f"- selector: `{selector}`",
        f"- posts fetched: {posts}",
        f"- laws staged: {len(laws)}",
        f"- rows staged: {rows}",
        f"- repealed rows skipped: {repealed}",
        f"- requests made: {requests}",
        f"- blocked: {blocked or 'none'}",
        "", "## Staged laws", "",
    ]
    lines += [f"- {x['title']} ({x['kind']}, {len(x['rows'])} rows) - {x['link']}" for x in laws]
    lines += ["", "## Blocked", "", blocked or "- none", ""]
    path.write_text("\n".join(lines), encoding="utf-8")


def stage_posts(kind: str, selector: str, posts_iter, client: Client, out_dir: Path, date: str) -> int:
    """Collect posts, parse them into rows, then write ONE new jsonl + report. Never overwrites."""
    retrieved_at = now_iso()
    laws: list[dict] = []
    all_rows: list[dict] = []
    repealed = 0
    seen_posts: set = set()
    blocked: str | None = None
    try:
        for post in posts_iter:
            pid = post.get("id")
            if pid in seen_posts:
                continue
            seen_posts.add(pid)
            parsed = post_to_rows(post, retrieved_at)
            repealed += parsed["repealed"]
            if parsed["rows"]:
                laws.append(parsed)
                all_rows.extend(parsed["rows"])
    except BudgetExhausted as exc:
        blocked = f"budget: {exc}"
    except Blocked as exc:
        blocked = str(exc)
    except FetchFailed as exc:
        blocked = f"fetch failed: {exc}"

    rows = dedupe_rows(all_rows)
    out_path = out_dir / f"ekhtebar_api_{kind}_{date}.jsonl"
    if rows:
        ss().write_new_jsonl(out_path, rows)
    report_path = out_dir / f"ekhtebar_api_{kind}_{date}.md"
    if report_path.exists():
        raise SystemExit(f"refusing to overwrite existing report: {report_path}")
    write_report(report_path, kind, date, selector, len(seen_posts), laws, len(rows), repealed,
                 client.requests, blocked)  # fmt: skip
    print(f"rows: {len(rows)} -> {out_path if rows else '(no rows, not written)'}")
    print(f"report: {report_path}\nrequests: {client.requests}\nblocked: {blocked or 'none'}")
    return 6 if blocked else 0


def _resolve(fn, client: Client, *args):
    """Resolve a tag/category, turning a hard stop into (None, exit_code)."""
    try:
        return fn(client, *args), None
    except BudgetExhausted as exc:
        print(f"STOPPED (budget): {exc}", file=sys.stderr)
        return None, 6
    except Blocked as exc:
        print(f"STOPPED (not bypassed): {exc}", file=sys.stderr)
        return None, 6
    except FetchFailed as exc:
        print(f"FETCH FAILED: {exc}", file=sys.stderr)
        return None, 2


def run_tag(client: Client, base: str, slug_or_name: str, out_dir: Path, date: str,
            max_pages: int | None = None) -> int:  # fmt: skip
    tag, rc = _resolve(resolve_tag, client, base, slug_or_name)
    if tag is None:
        if rc is None:
            print(f"tag not found: {slug_or_name}", file=sys.stderr)
            rc = 2
        return rc
    selector = f"tag {tag['slug']} (id {tag['id']})"
    return stage_posts("tag", selector, iter_posts(client, base, {"tags": tag["id"]}, max_pages),
                       client, out_dir, date)  # fmt: skip


def run_category(client: Client, base: str, slug: str, out_dir: Path, date: str,
                 max_pages: int | None = None) -> int:  # fmt: skip
    cat, rc = _resolve(resolve_category, client, base, slug)
    if cat is None:
        if rc is None:
            print(f"category not found: {slug}", file=sys.stderr)
            rc = 2
        return rc
    selector = f"category {cat['slug']} (id {cat['id']})"
    return stage_posts("category", selector, iter_posts(client, base, {"categories": cat["id"]}, max_pages),
                       client, out_dir, date)  # fmt: skip


def run_search(client: Client, base: str, query: str, out_dir: Path, date: str,
               limit: int | None = None) -> int:  # fmt: skip
    def limited():
        n = 0
        for post in iter_posts(client, base, {"search": query}):
            if limit is not None and n >= limit:
                return
            n += 1
            yield post

    return stage_posts("search", f'search "{query}"', limited(), client, out_dir, date)


# ----------------------------------------------------------------------------- gaps
def load_corpus_names(path: Path) -> set[str]:
    """Normalised law names from a plain text file, a JSON list, a JSONL file, or a coverage manifest."""
    text = path.read_text(encoding="utf-8")
    names: list[str] = []
    try:
        doc = json.loads(text)
    except ValueError:
        doc = None
    if isinstance(doc, dict) and isinstance(doc.get("laws"), list):
        names = [str(x.get("name", "")) for x in doc["laws"] if isinstance(x, dict)]
    elif isinstance(doc, list):
        names = [str(x.get("name", "")) if isinstance(x, dict) else str(x) for x in doc]
    else:
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                names.append(line)
                continue
            if isinstance(rec, dict) and rec.get("law_name"):
                names.append(str(rec["law_name"]))
    norm = ss().norm_name
    return {norm(n) for n in names if n}


def run_gaps(client: Client, base: str, corpus_laws: Path, out_dir: Path, date: str, *,
             tags=(), categories=(), searches=(), max_pages: int | None = None) -> int:  # fmt: skip
    corpus = load_corpus_names(corpus_laws)
    if not corpus:
        print(f"no law names in {corpus_laws}", file=sys.stderr)
        return 2
    tag_values = list(tags)
    cat_values = list(categories)
    search_values = list(searches)
    if not (tag_values or cat_values or search_values):
        tag_values = list(DEFAULT_GAP_TAGS)
    params: list[dict] = []
    for t in tag_values:
        tag, rc = _resolve(resolve_tag, client, base, t)
        if rc is not None:
            return rc
        if tag:
            params.append({"tags": tag["id"]})
    for c in cat_values:
        cat, rc = _resolve(resolve_category, client, base, c)
        if rc is not None:
            return rc
        if cat:
            params.append({"categories": cat["id"]})
    for q in search_values:
        params.append({"search": q})
    if not params:
        print("no matching selectors for gaps", file=sys.stderr)
        return 2
    norm = ss().norm_name

    def gap_posts():
        for p in params:
            for post in iter_posts(client, base, p, max_pages):
                title = strip_tags((post.get("title") or {}).get("rendered") or "")
                if norm(title) in corpus:
                    continue
                yield post

    selector = "gaps " + "; ".join(
        [f"tag:{t}" for t in tag_values] + [f"category:{c}" for c in cat_values]
        + [f'search:"{q}"' for q in search_values]
    )
    return stage_posts("gaps", selector, gap_posts(), client, out_dir, date)


# ----------------------------------------------------------------------------- CLI
def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default=BASE, help=f"site base URL (default {BASE})")
    ap.add_argument("--delay", type=float, default=MIN_DELAY, help="seconds between requests (min 2)")
    ap.add_argument("--max-requests", type=int, default=DEFAULT_MAX_REQUESTS, help="request budget per run")
    ap.add_argument("--out-dir", type=Path, default=ROOT / "data/legal/staged")
    sub = ap.add_subparsers(dest="cmd", required=True)

    t = sub.add_parser("tag")
    t.add_argument("slug_or_name")
    t.add_argument("--max-pages", type=int, default=None)
    c = sub.add_parser("category")
    c.add_argument("slug")
    c.add_argument("--max-pages", type=int, default=None)
    s = sub.add_parser("search")
    s.add_argument("query")
    s.add_argument("--limit", type=int, default=None)
    g = sub.add_parser("gaps")
    g.add_argument("--corpus-laws", type=Path, required=True)
    g.add_argument("--tag", action="append", default=[])
    g.add_argument("--category", action="append", default=[])
    g.add_argument("--search", action="append", default=[])
    g.add_argument("--max-pages", type=int, default=None)
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    client = Client(args.delay, args.max_requests)
    date = datetime.now(UTC).strftime("%Y-%m-%d")
    if args.cmd == "tag":
        return run_tag(client, args.base, args.slug_or_name, args.out_dir, date, args.max_pages)
    if args.cmd == "category":
        return run_category(client, args.base, args.slug, args.out_dir, date, args.max_pages)
    if args.cmd == "search":
        return run_search(client, args.base, args.query, args.out_dir, date, args.limit)
    return run_gaps(client, args.base, args.corpus_laws, args.out_dir, date, tags=args.tag,
                    categories=args.category, searches=args.search, max_pages=args.max_pages)  # fmt: skip


if __name__ == "__main__":
    sys.exit(main())
