"""Brand profiles, source items, the claim check and the weekly planner (stdlib only)."""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import urllib.parse

import mkt_yaml

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("MKT_REPO", os.path.abspath(os.path.join(HERE, "..", "..")))
CONFIG_DIR = os.environ.get("MKT_CONFIG_DIR", os.path.join(REPO, "config", "marketing"))
BRAND_RE = re.compile(r"^[a-z0-9-]{1,40}$")
PLATFORMS = ("instagram", "facebook", "linkedin", "x", "telegram")
# caption budget (characters, before link/hashtags) and hashtag cap per platform
LIMITS = {
    "instagram": {"caption": 1800, "tags": 8},
    "facebook": {"caption": 1500, "tags": 3},
    "linkedin": {"caption": 1500, "tags": 3},
    "x": {"caption": 180, "tags": 2},
    "telegram": {"caption": 900, "tags": 3},
}
SOURCE_PROMPT_CHARS = 3500
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


# ------------------------------------------------------------------ brand
def load_brand(name: str) -> dict:
    if not BRAND_RE.fullmatch(name or ""):
        raise ValueError("invalid brand name (a-z, 0-9, '-')")
    path = os.path.join(CONFIG_DIR, name + ".yaml")
    with open(path, encoding="utf-8") as fh:
        brand = mkt_yaml.parse(fh.read())
    brand["id"] = name
    for key in ("name", "audience", "tone", "platforms", "cadence", "source"):
        if not brand.get(key):
            raise ValueError(f"brand {name}: missing '{key}'")
    brand["platforms"] = [p for p in brand["platforms"] if p in PLATFORMS]
    brand.setdefault("languages", ["en"])
    brand.setdefault("banned_claims", [])
    brand.setdefault("banned_phrases", [])
    brand.setdefault("hashtags", [])
    brand.setdefault("post_hours", [10, 19])
    brand.setdefault("links", {})
    return brand


# ----------------------------------------------------------------- sources
_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def ascii_digits(text: str) -> str:
    return text.translate(_DIGITS)


def parse_front_matter(text: str):
    """Return (meta dict of simple scalars, body)."""
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end < 0:
        return {}, text
    meta = {}
    for line in text[3:end].splitlines():
        m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if m and m.group(2).strip():
            meta[m.group(1)] = m.group(2).strip().strip("\"'")
    return meta, text[end + 4:].lstrip("\n")


def published_slugs(index_ts: str):
    """Slugs in the GUIDE_SLUGS array of guides.ts (None if the file is unavailable)."""
    try:
        with open(index_ts, encoding="utf-8") as fh:
            src = fh.read()
    except OSError:
        return None
    m = re.search(r"GUIDE_SLUGS\s*=\s*\[(.*?)\]", src, re.S)
    return re.findall(r"[\"']([a-z0-9-]+)[\"']", m.group(1)) if m else None


def load_sources(brand: dict, repo: str | None = None) -> list:
    """Items a post may be about: {id, title, description, text, url}."""
    repo = repo or REPO
    src = brand["source"]
    directory = os.path.join(repo, src.get("dir", ""))
    slugs = published_slugs(os.path.join(repo, src["index_ts"])) if src.get("index_ts") else None
    site = str(brand["links"].get("site", "")).rstrip("/")
    base_path = str(src.get("base_path", "/")).rstrip("/")
    items = []
    try:
        names = sorted(os.listdir(directory))
    except OSError:
        return []
    ordered = [n for n in names if n.endswith(".md")]
    if slugs is not None:
        by_slug = {n[:-3]: n for n in ordered}
        ordered = [by_slug[s] for s in slugs if s in by_slug]
    for name in ordered:
        with open(os.path.join(directory, name), encoding="utf-8") as fh:
            meta, body = parse_front_matter(fh.read())
        slug = meta.get("slug") or name[:-3]
        items.append({
            "id": slug,
            "title": meta.get("title", slug),
            "description": meta.get("description", ""),
            "text": body,
            "url": f"{site}{base_path}/{slug}" if site else "",
        })
    return items


# ------------------------------------------------------------- claim check
_URL = re.compile(r"https?://\S+")
_NUM = re.compile(r"\d+(?:[.,٫،]\d+)*")
_REF = re.compile(r"(ماده|مواد|بند|تبصره|article|art\.|section|clause)\s*$", re.I)


def _num_key(token: str) -> str:
    return re.sub(r"[.,٫،]", "", token)


def numbers_in(text: str) -> list:
    """(key, preceded_by_reference_word) for every number in text (URLs ignored)."""
    text = ascii_digits(_URL.sub(" ", text))
    out = []
    for m in _NUM.finditer(text):
        out.append((_num_key(m.group(0)), bool(_REF.search(text[max(0, m.start() - 12):m.start()]))))
    return out


def check_claims(text: str, source_text: str, banned_phrases=()) -> list:
    """Return a list of violations (empty = ok): numbers / article references that are not in
    the source text, and any banned phrase."""
    allowed = {k for k, _ in numbers_in(source_text)}
    problems = []
    for key, is_ref in numbers_in(text):
        if key not in allowed:
            problems.append(f"{'article reference' if is_ref else 'number'} {key} is not in the source")
    low = text.lower()
    for phrase in banned_phrases:
        if str(phrase).strip() and str(phrase).lower() in low:
            problems.append(f"banned phrase: {phrase}")
    return problems


# ------------------------------------------------------------------ planner
def campaign_id(brand_id: str, start: dt.date) -> str:
    iso = start.isocalendar()
    return f"{brand_id}-{iso[0]}w{iso[1]:02d}"


def build_link(item: dict, platform: str, campaign: str) -> str:
    if not item.get("url"):
        return ""
    query = urllib.parse.urlencode({"utm_source": platform, "utm_medium": "social",
                                    "utm_campaign": campaign, "utm_content": item["id"]})
    return item["url"] + ("&" if "?" in item["url"] else "?") + query


def week_start(brand: dict, today: dt.date, explicit: dt.date | None = None) -> dt.date:
    """First day of the NEXT week according to brand.week_start (or the explicit date)."""
    if explicit:
        return explicit
    target = WEEKDAYS.index(str(brand.get("week_start", "monday")).lower())
    delta = (target - today.weekday()) % 7 or 7
    return today + dt.timedelta(days=delta)


def _local_epoch(day: dt.date, hour: int, tz_name: str) -> int:
    try:
        import zoneinfo
        tz = zoneinfo.ZoneInfo(tz_name)
    except Exception:
        tz = dt.timezone.utc
    return int(dt.datetime(day.year, day.month, day.day, int(hour), 0, tzinfo=tz).timestamp())


def slots(brand: dict, platform: str, start: dt.date) -> list:
    n = int(brand["cadence"].get(platform, 0) or 0)
    hours = brand["post_hours"] if isinstance(brand["post_hours"], list) else [10]
    tz = str(brand.get("timezone", "UTC"))
    return [_local_epoch(start + dt.timedelta(days=round(i * 7 / n)), hours[i % len(hours)], tz)
            for i in range(n)]


def system_prompt(brand: dict, platform: str, lang: str) -> str:
    banned = "\n".join(f"- {b}" for b in brand["banned_claims"]) or "- (none listed)"
    return (
        f"You write one social media post for the brand '{brand['name']}' on {platform}.\n"
        f"Audience: {brand['audience']}\nTone: {brand['tone']}\nWrite the caption in language code: {lang}.\n"
        "HARD RULES:\n"
        "- Use ONLY facts stated in the SOURCE. Do not add any number, date, price, law name or "
        "article/clause reference that is not written in the SOURCE.\n"
        "- Never give legal advice or promise outcomes; invite readers to read the full guide.\n"
        "- Do not put any URL in the caption (a tracked link is added automatically).\n"
        f"- Maximum {LIMITS[platform]['caption']} characters for the caption.\n"
        f"Never claim:\n{banned}\n"
        "Reply with ONE JSON object only: "
        '{"caption": "...", "hashtags": ["#..."], "image_prompt": "<English visual description, '
        'no text inside the image, no real people or logos>"}'
    )


def parse_draft(raw: str) -> dict:
    m = re.search(r"\{.*\}", raw, re.S)
    if not m:
        raise ValueError("no JSON object in model output")
    data = json.loads(m.group(0))
    if not isinstance(data, dict) or not str(data.get("caption", "")).strip():
        raise ValueError("missing caption")
    return data


def clean_tags(brand: dict, platform: str, suggested) -> list:
    tags = []
    for t in list(brand["hashtags"]) + list(suggested if isinstance(suggested, list) else []):
        t = "#" + re.sub(r"[\s#]+", "_", str(t).strip()).strip("_")
        if len(t) > 1 and t not in tags:
            tags.append(t)
    return tags[:LIMITS[platform]["tags"]]


def make_draft(brand, platform, item, llm, lang, attempts: int = 3):
    """One validated draft dict, or (None, [reasons]). `llm(system, user) -> str`."""
    source_text = f"{item['title']}\n{item['description']}\n{item['text']}"
    user = (f"SOURCE title: {item['title']}\nSOURCE summary: {item['description']}\n"
            f"SOURCE text:\n{item['text'][:SOURCE_PROMPT_CHARS]}")
    reasons: list = []
    for _ in range(attempts):
        prompt = user + ("\n\nYour previous attempt was rejected: " + "; ".join(reasons) if reasons else "")
        try:
            draft = parse_draft(llm(system_prompt(brand, platform, lang), prompt))
        except (ValueError, json.JSONDecodeError) as exc:
            reasons = [f"invalid output ({exc})"]
            continue
        caption = str(draft["caption"]).strip()
        tags = clean_tags(brand, platform, draft.get("hashtags"))
        reasons = check_claims(caption + " " + " ".join(tags), source_text, brand["banned_phrases"])
        if len(caption) > LIMITS[platform]["caption"]:
            reasons.append(f"caption longer than {LIMITS[platform]['caption']} characters")
        if not reasons:
            return {"caption": caption, "hashtags": tags,
                    "image_prompt": str(draft.get("image_prompt", ""))[:500]}, []
    return None, reasons


def plan_week(store, brand: dict, items: list, llm, start: dt.date) -> dict:
    """Create draft posts for the week. Returns {created: [ids], skipped: [(platform, item, reasons)]}."""
    campaign = campaign_id(brand["id"], start)
    report = {"campaign": campaign, "created": [], "skipped": []}
    if not items:
        report["skipped"].append(("*", "*", ["no source items"]))
        return report
    langs = brand["languages"]
    for platform in brand["platforms"]:
        lang = (brand.get("platform_languages") or {}).get(platform) or langs[0]
        existing = sum(1 for r in store.list("posts", brand=brand["id"], platform=platform, campaign=campaign)
                       if r["status"] != "rejected")
        for when in slots(brand, platform, start)[existing:]:  # re-running only fills missing slots
            # least-used source first, keeping the listed order for ties
            ranked = sorted(range(len(items)),
                            key=lambda i: (store.has_source(brand["id"], platform, items[i]["id"]), i))
            for idx in ranked[:3]:
                item = items[idx]
                if store.has_source(brand["id"], platform, item["id"]) and any(
                        r["campaign"] == campaign for r in store.list(
                            "posts", brand=brand["id"], platform=platform, source_id=item["id"])):
                    continue
                draft, reasons = make_draft(brand, platform, item, llm, lang)
                if draft is None:
                    report["skipped"].append((platform, item["id"], reasons))
                    continue
                pid = store.add_post(
                    brand=brand["id"], platform=platform, campaign=campaign, source_id=item["id"],
                    source_title=item["title"], lang=lang, caption=draft["caption"],
                    hashtags=draft["hashtags"], link=build_link(item, platform, campaign),
                    image_prompt=draft["image_prompt"], scheduled_at=when)
                if pid:
                    report["created"].append(pid)
                    break
            else:
                report["skipped"].append((platform, "-", ["no usable source item left for this slot"]))
    return report
