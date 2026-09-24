"""Query translation for multilingual sourcing (W9 Phase B).

tech_radar previously only ever queried English-language search providers, so
every kept source was an English blog round-up (docs/research/bakeoff.md §1
finding 1). This module translates a research query into the languages the
owner asked for (zh/ja/de/ko/ru) and translates findings back to Persian/
English, always keeping the original-language source URL next to a finding
so a claim stays spot-checkable.

Translation goes through the `free` tier (falls through to `cheap` on a 429,
see llm_router) — it is a short, non-sensitive, mechanical text transform and
does not deserve `strong`-tier spend.
"""

from __future__ import annotations

import logging
from typing import NamedTuple

from src.automation.llm_router_bridge import call_llm

logger = logging.getLogger("roxira.tech_radar.translate")

LANGUAGES: dict[str, str] = {
    "zh": "Simplified Chinese",
    "ja": "Japanese",
    "de": "German",
    "ko": "Korean",
    "ru": "Russian",
}

_TRANSLATE_SYSTEM = (
    "You are a precise technical translator. Translate the user's short search "
    "query into the target language, keeping product names, code identifiers "
    "and version numbers unchanged. Reply with ONLY the translated query text, "
    "no quotes, no explanation, no markdown."
)


class TranslatedQuery(NamedTuple):
    lang: str
    lang_name: str
    text: str
    ok: bool


def translate_query(query: str, lang: str) -> TranslatedQuery:
    lang_name = LANGUAGES.get(lang, lang)
    prompt = f"Target language: {lang_name}\nQuery: {query}"
    response = call_llm(
        "free",
        prompt,
        _TRANSLATE_SYSTEM,
        temperature=0.0,
        max_tokens=200,
        feature="query_translation",
    )
    if response.get("status") != "SUCCESS":
        logger.warning("query translation to %s failed: %s", lang, response.get("error"))
        return TranslatedQuery(lang=lang, lang_name=lang_name, text=query, ok=False)
    text = response["content"].strip().strip('"').strip()
    return TranslatedQuery(lang=lang, lang_name=lang_name, text=text or query, ok=bool(text))


def translate_queries(query: str, langs: list[str] | None = None) -> list[TranslatedQuery]:
    langs = langs or list(LANGUAGES)
    out: list[TranslatedQuery] = []
    for lang in langs:
        out.append(translate_query(query, lang))
    return out
