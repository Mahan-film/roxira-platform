"""Deterministic "core articles by claim type" for the Smart Judge drafts.

Vector search alone did not retrieve the governing articles of a plain loan claim, so the
draft cores (ruling / indictment / paid drafts) also run this matcher: keyword rules in
``config/drafting_core_articles.yaml`` name (law_name, article_no) pairs, which are then
fetched by an exact payload lookup and merged in FRONT of the vector results before the prompt.

Safety properties
* Only rules with ``status: confirmed`` are used; ``needs_lawyer`` rules are documentation.
* Article text never lives in the YAML. A pair the lookup does not return (missing, repealed,
  wrong law name) is silently skipped, so nothing we do not hold can be injected.
* Pure except for the injected async ``fetch``; no logging of case text; never raises on a
  failed lookup.
"""

from __future__ import annotations

import asyncio
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional, Sequence, Tuple

import yaml

_DEFAULT_PATH = Path(__file__).resolve().parents[3] / "config" / "drafting_core_articles.yaml"
_ALLOWED_STATUSES = {"confirmed", "needs_lawyer"}
MAX_CORE_ARTICLES = 10
MAX_MATCH_TEXT = 20000

_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_CHARS = str.maketrans(
    {
        "ي": "ی", "ى": "ی", "ئ": "ی", "ك": "ک", "ة": "ه", "ۀ": "ه", "آ": "ا", "أ": "ا", "إ": "ا",
        "ٱ": "ا", "ؤ": "و", "ـ": "", "‌": " ", "‍": "", "ء": "",
    }
)
_DIACRITICS = re.compile("[ً-ٰٟ]")
_WORD = re.compile(r"[\w]+", re.UNICODE)
_WHOLE_WORD_SUFFIXES = ("", "ها", "های", "ی", "ای", "هایی", "م", "ش", "ت")

Target = Dict[str, Any]  # {"rule_id", "law_names": tuple[str, ...], "article_no": str}
FetchOne = Callable[[Sequence[str], str], Awaitable[Optional[Dict[str, Any]]]]


def normalize(text: Any) -> str:
    s = str(text or "").translate(_DIGITS).translate(_CHARS)
    s = _DIACRITICS.sub("", s).lower()
    return re.sub(r"\s+", " ", s).strip()


def load_rules(path: str | Path | None = None) -> List[Dict[str, Any]]:
    """Load and validate the rules (cached per path). Raises ValueError on a malformed file."""
    return _load(str((_DEFAULT_PATH if path is None else Path(path)).resolve()))


@lru_cache(maxsize=None)
def _load(path: str) -> List[Dict[str, Any]]:
    with open(path, encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    if not isinstance(doc, dict) or not isinstance(doc.get("rules"), list):
        raise ValueError("drafting core articles YAML must contain a rules list")
    seen: set = set()
    rules: List[Dict[str, Any]] = []
    for raw in doc["rules"]:
        if not isinstance(raw, dict) or not isinstance(raw.get("id"), str):
            raise ValueError("each rule needs a string id")
        if raw["id"] in seen:
            raise ValueError(f"duplicate rule id: {raw['id']}")
        seen.add(raw["id"])
        if raw.get("status") not in _ALLOWED_STATUSES:
            raise ValueError(f"rule {raw['id']}: status must be confirmed or needs_lawyer")
        triggers = raw.get("triggers")
        if not isinstance(triggers, list) or not triggers or not all(isinstance(t, str) and t for t in triggers):
            raise ValueError(f"rule {raw['id']}: triggers must be a non-empty list of strings")
        articles = raw.get("articles")
        if not isinstance(articles, list):
            raise ValueError(f"rule {raw['id']}: articles must be a list")
        for art in articles:
            names = art.get("law_names") if isinstance(art, dict) else None
            number = str(art.get("article_no", "")) if isinstance(art, dict) else ""
            if not isinstance(names, list) or not names or not all(isinstance(n, str) and n for n in names):
                raise ValueError(f"rule {raw['id']}: every article needs law_names")
            if not number.isdigit():
                raise ValueError(f"rule {raw['id']}: article_no must be a number")
        rule = dict(raw)
        rule["priority"] = int(raw.get("priority", 100))
        rule["_triggers"] = tuple(_compile_trigger(t) for t in triggers)
        rules.append(rule)
    rules.sort(key=lambda r: r["priority"])
    return rules


def _compile_trigger(trigger: str) -> Tuple[bool, str]:
    whole = trigger.startswith("=")
    return whole, normalize(trigger[1:] if whole else trigger)


def _fires(rule: Dict[str, Any], words: List[str], text: str) -> bool:
    for whole, trig in rule["_triggers"]:
        if not trig:
            continue
        if " " in trig:
            if re.search(r"(?:^| )" + re.escape(trig), text):
                return True
        elif whole:
            if any(w == trig or (w.startswith(trig) and w[len(trig):] in _WHOLE_WORD_SUFFIXES) for w in words):
                return True
        elif any(w.startswith(trig) for w in words):
            return True
    return False


def core_targets(
    text: str,
    rules: Optional[Sequence[Dict[str, Any]]] = None,
    limit: int = MAX_CORE_ARTICLES,
) -> List[Target]:
    """(law_names, article_no) pairs for every confirmed rule fired by ``text``, deduplicated,
    in rule-priority order, at most ``limit`` pairs."""
    if not isinstance(text, str) or not text.strip():
        return []
    norm = normalize(text[:MAX_MATCH_TEXT])
    words = _WORD.findall(norm)
    out: List[Target] = []
    seen: set = set()
    for rule in rules if rules is not None else load_rules():
        if rule["status"] != "confirmed" or not _fires(rule, words, norm):
            continue
        for art in rule["articles"]:
            number = str(art["article_no"]).lstrip("0") or "0"
            key = (tuple(art["law_names"]), number)
            if key in seen:
                continue
            seen.add(key)
            out.append({"rule_id": rule["id"], "law_names": tuple(art["law_names"]), "article_no": number})
            if len(out) >= limit:
                return out
    return out


def _row_key(row: Dict[str, Any]) -> Tuple[str, str]:
    return (normalize(row.get("law_name")), str(row.get("article_no") or "").strip().lstrip("0"))


async def fetch_core_articles(
    text: str,
    fetch: FetchOne,
    rules: Optional[Sequence[Dict[str, Any]]] = None,
    limit: int = MAX_CORE_ARTICLES,
) -> List[Dict[str, Any]]:
    """Run the matcher and fetch each target through ``fetch(law_names, article_no) -> row | None``.

    Rows come back as ``{"law_name", "article_no", "text"}`` in target order. A failed, empty or
    mismatching lookup drops that target; the function never raises.
    """
    targets = core_targets(text, rules, limit)
    if not targets:
        return []

    async def one(target: Target) -> Optional[Dict[str, Any]]:
        try:
            row = await fetch(target["law_names"], target["article_no"])
        except Exception:  # noqa: BLE001 - a failed lookup must never break the draft
            return None
        if not isinstance(row, dict):
            return None
        law, number, body = row.get("law_name"), row.get("article_no"), row.get("text") or row.get("summary")
        if not isinstance(law, str) or not law.strip() or not isinstance(body, str) or not body.strip():
            return None
        if str(number or "").strip().lstrip("0") != target["article_no"]:
            return None  # the lookup must return exactly the wanted article
        if normalize(law) not in {normalize(n) for n in target["law_names"]}:
            return None
        return {"law_name": law, "article_no": str(number), "text": body}

    fetched = await asyncio.gather(*(one(t) for t in targets))
    return [r for r in fetched if r is not None]


def merge_articles(
    core: Sequence[Dict[str, Any]], retrieved: Sequence[Dict[str, Any]], limit: int
) -> List[Dict[str, Any]]:
    """Core articles first, then the vector-retrieved ones, unique by (law, article), capped."""
    merged: List[Dict[str, Any]] = []
    seen: set = set()
    for row in list(core) + list(retrieved):
        if not isinstance(row, dict):
            continue
        key = _row_key(row)
        if key in seen:
            continue
        seen.add(key)
        merged.append(row)
        if len(merged) >= limit:
            break
    return merged
