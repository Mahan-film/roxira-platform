"""`project-brief` mode (W9 Phase B, item 3): a per-layer, new-project stack
recommender built on top of tech_radar's existing multilingual sourcing
pipeline instead of a full agent harness (docs/research/bakeoff.md §5).

For one idea string, this module researches each architecture layer
(UI/UX, frontend, backend, infra/server, database/SQL, AI models,
observability, security, cost) independently — same search → crawl → rerank
→ synthesize pipeline as daily-radar, `cheap`-tier synthesis per layer — then
runs one final `strong`-tier synthesis call that reconciles all layers into
one coherent recommendation. Output goes to
``docs/research/briefs/<slug>.md`` (+ a sibling ``.json``).

Budget discipline (owner brief): every layer call uses cheap/free tiers;
`strong` is spent exactly once, on the final reconciliation.
"""

from __future__ import annotations

import json
import logging
import pathlib
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Optional

from src.automation.budget_guard import BudgetExceeded, BudgetGuard
from src.automation.llm_router_bridge import call_llm
from src.automation.tech_radar import (
    DEFAULT_REPORT_LANG,
    PROJECT_BRIEF_FINAL_TIER,
    PROJECT_BRIEF_LAYER_TIER,
    TechRadarAgent,
    _extract_json,
    _report_language_name,
    _truncate,
)

logger = logging.getLogger("roxira.tech_radar.project_brief")

PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_BRIEFS_DIR = PROJECT_ROOT / "docs" / "research" / "briefs"


@dataclass(frozen=True)
class Layer:
    key: str
    label_fa: str
    label_en: str
    query_hint: str


LAYERS: tuple[Layer, ...] = (
    Layer("ui_ux", "رابط و تجربه کاربری (UI/UX)", "UI/UX", "design system and UX pattern choices"),
    Layer("frontend", "فرانت‌اند", "Frontend", "frontend framework and rendering strategy"),
    Layer("backend", "بک‌اند", "Backend", "backend framework and API architecture"),
    Layer("infra_server", "زیرساخت و سرور", "Infra/Server", "hosting, containers and deployment infrastructure"),
    Layer("database_sql", "پایگاه داده و SQL", "Database/SQL", "database engine and data layer"),
    Layer("ai_models", "مدل‌های هوش مصنوعی", "AI Models", "LLM/AI model and inference provider choices"),
    Layer("observability", "رصدپذیری (Observability)", "Observability", "logging, metrics, tracing and alerting stack"),
    Layer("security", "امنیت", "Security", "authentication, authorization and security hardening stack"),
    Layer("cost", "هزینه و FinOps", "Cost/FinOps", "cost tracking, budgeting and usage-based billing tooling"),
)

LAYER_SCHEMA_HINT = """{
  "summary": "خلاصه یک تا دو جمله‌ای این لایه",
  "alternatives": [
    {
      "name": "نام فناوری/سرویس",
      "maturity": "emerging|growing|mainstream",
      "license": "نوع مجوز (مثلاً MIT، Apache-2.0، Proprietary)",
      "adoption_score": 0,
      "risks": ["ریسک ۱"],
      "monthly_cost_usd_estimate": "برآورد هزینه ماهانه به دلار برای یک استارتاپ کوچک",
      "why": "چرا این گزینه مناسب این لایه/ایده است"
    }
  ],
  "recommended": "نام گزینه توصیه‌شده از میان alternatives",
  "recommendation_reason": "یک جمله توجیه انتخاب"
}"""

def _layer_system_prompt(report_lang: str = DEFAULT_REPORT_LANG) -> str:
    return (
        "You are a ROXIRA layer-specialist technology scout. Ground every claim in the "
        "provided sources; never invent a product, license or price. Give 2 to 3 real "
        "alternatives, each with an adoption_score from 0 (unproven) to 10 (industry "
        f"standard). Write narrative fields in {_report_language_name(report_lang)}; keep "
        "product/technology names in their original English form. Respond ONLY with one "
        "valid JSON object, no markdown fences."
    )


# Backward-compatible default (fa) for any caller that imports the constant directly.
LAYER_SYSTEM_PROMPT = _layer_system_prompt(DEFAULT_REPORT_LANG)

FINAL_SCHEMA_HINT = """{
  "executive_summary": "چکیده مدیریتی ۴ تا ۶ جمله‌ای برای کل پروژه",
  "cross_layer_risks": ["ریسکی که بین چند لایه مشترک است"],
  "total_monthly_cost_usd_estimate": "جمع تخمینی هزینه ماهانه کل استک برای یک استارتاپ کوچک",
  "build_order": ["ترتیب پیشنهادی ساخت لایه‌ها"],
  "open_questions_for_owner": ["سوالی که پاسخش را فقط مالک پروژه می‌داند"]
}"""

def _final_system_prompt(report_lang: str = DEFAULT_REPORT_LANG) -> str:
    return (
        "You are the ROXIRA Chief Technology Scout doing final reconciliation across "
        "already-researched architecture layers for one new project. Do not invent new "
        "technologies; only reconcile, prioritize and flag conflicts between the "
        f"per-layer recommendations you are given. Write narrative fields in "
        f"{_report_language_name(report_lang)}; keep product/technology names in English. "
        "Respond ONLY with one valid JSON object, no markdown fences."
    )


# Backward-compatible default (fa) for any caller that imports the constant directly.
FINAL_SYSTEM_PROMPT = _final_system_prompt(DEFAULT_REPORT_LANG)


def _slugify(idea: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", idea.lower()).strip("-")
    return (slug or "project-brief")[:80]


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def normalize_alternatives(alts: list) -> list[dict]:
    """Normalise common LLM alternative-key variants to the proposal schema."""
    normalized = []
    aliases = {
        "name": ("name", "name_en", "title"),
        "why": ("why", "why_it_matters_for_this_project_fa"),
        "license": ("license", "license_or_pricing_note_fa"),
    }
    for alt in alts:
        if not isinstance(alt, dict):
            continue
        item = alt.copy()
        for field, keys in aliases.items():
            value = next((item.get(key) for key in keys if item.get(key)), None)
            if value:
                item[field] = value
        if item.get("name"):
            normalized.append(item)
    return normalized


def _research_layer(
    agent: TechRadarAgent, idea: str, layer: Layer, report_lang: str = DEFAULT_REPORT_LANG
) -> dict[str, Any]:
    topic = f"{idea[:160]} — {layer.query_hint} {layer.label_en} comparison"
    ranked, _search_bundle = agent.gather_sources(topic, deep=False)
    source_index = "\n".join(
        f"- {s.get('title', '')} | {s.get('url', '')} | lang={s.get('source_lang', 'en')} | "
        f"score={s.get('relevance_score', 0.0)}"
        for s in ranked
    )
    context = "\n\n---\n\n".join(
        f"[SOURCE {i}] {s.get('title', '')} ({s.get('url', '')})\n{_truncate(s.get('content', ''), 2500)}"
        for i, s in enumerate(ranked, start=1)
    )[:18000]

    prompt = (
        f"ایده پروژه: {idea}\n"
        f"لایه معماری مورد بررسی: {layer.label_en} ({layer.label_fa})\n\n"
        f"منابع برگزیده:\n{source_index or 'هیچ منبعی یافت نشد.'}\n\n"
        f"محتوای خزش‌شده:\n{context}\n\n"
        "بر اساس صرفاً همین شواهد، برای همین یک لایه معماری، ۲ تا ۳ گزینه واقعی با "
        "امتیاز بلوغ/مجوز/پذیرش، ریسک‌ها و برآورد هزینه ماهانه ارائه بده. خروجی را "
        f"دقیقاً مطابق این اسکیما بازگردان:\n{LAYER_SCHEMA_HINT}"
    )

    if not ranked:
        return {
            "layer": layer.key,
            "label_fa": layer.label_fa,
            "label_en": layer.label_en,
            "status": "FAILED",
            "summary": "",
            "alternatives": [],
            "recommended": "",
            "recommendation_reason": "هیچ منبعی برای این لایه یافت نشد (کلید موتور جست‌وجو تنظیم نشده یا نتیجه‌ای برنگشت).",
            "sources": [],
            "cost_usd": 0.0,
        }

    response = call_llm(
        PROJECT_BRIEF_LAYER_TIER,
        prompt,
        _layer_system_prompt(report_lang),
        temperature=0.2,
        max_tokens=3000,
        json_mode=True,
        feature=f"project_brief_layer_{layer.key}",
    )
    if response.get("status") != "SUCCESS":
        return {
            "layer": layer.key,
            "label_fa": layer.label_fa,
            "label_en": layer.label_en,
            "status": "FAILED",
            "summary": "",
            "alternatives": [],
            "recommended": "",
            "recommendation_reason": f"فراخوانی مدل شکست خورد: {response.get('error')}",
            "sources": [s.get("url", "") for s in ranked],
            "cost_usd": 0.0,
        }

    parsed = _extract_json(response.get("content", "")) or {}
    alternatives = normalize_alternatives(parsed.get("alternatives") or [])
    parsed["alternatives"] = alternatives
    names = {alternative["name"] for alternative in alternatives}
    if alternatives and parsed.get("recommended") not in names:
        parsed["recommended"] = max(
            alternatives,
            key=lambda alternative: alternative.get("adoption_score")
            if isinstance(alternative.get("adoption_score"), (int, float))
            and not isinstance(alternative.get("adoption_score"), bool)
            else 0,
        )["name"]
    ok = bool(parsed.get("alternatives"))
    return {
        "layer": layer.key,
        "label_fa": layer.label_fa,
        "label_en": layer.label_en,
        "status": "SUCCESS" if ok else "DEGRADED",
        "summary": parsed.get("summary", ""),
        "alternatives": parsed.get("alternatives") or [],
        "recommended": parsed.get("recommended", ""),
        "recommendation_reason": parsed.get("recommendation_reason", ""),
        "sources": [
            {"title": s.get("title", ""), "url": s.get("url", ""), "source_lang": s.get("source_lang", "en")}
            for s in ranked
        ],
        "model": response.get("model"),
        "cost_usd": response.get("cost_usd", 0.0),
    }


def _final_synthesis(
    idea: str, layers: list[dict[str, Any]], report_lang: str = DEFAULT_REPORT_LANG
) -> dict[str, Any]:
    layer_digest = "\n\n".join(
        f"### {layer['label_en']} ({layer['label_fa']}) — وضعیت: {layer['status']}\n"
        f"خلاصه: {layer.get('summary', '')}\n"
        f"توصیه: {layer.get('recommended', '')} — {layer.get('recommendation_reason', '')}\n"
        f"گزینه‌ها: {json.dumps(layer.get('alternatives', []), ensure_ascii=False)}"
        for layer in layers
    )
    prompt = (
        f"ایده پروژه: {idea}\n\n"
        f"خروجی تحقیق هر لایه معماری (از پیش انجام‌شده):\n{layer_digest}\n\n"
        "این توصیه‌های لایه‌به‌لایه را در یک بریف نهایی جمع‌بندی کن. فناوری جدیدی اختراع "
        "نکن؛ فقط لایه‌ها را اولویت‌بندی کن، تضادها (مثلاً تضاد بین گزینه پیشنهادی بک‌اند "
        "و دیتابیس) را مشخص کن و هزینه ماهانه کل را جمع بزن. خروجی را دقیقاً مطابق این "
        f"اسکیما بازگردان:\n{FINAL_SCHEMA_HINT}"
    )
    response = call_llm(
        PROJECT_BRIEF_FINAL_TIER,
        prompt,
        _final_system_prompt(report_lang),
        temperature=0.2,
        max_tokens=3000,
        json_mode=True,
        feature="project_brief_final",
    )
    if response.get("status") != "SUCCESS":
        return {
            "status": "FAILED",
            "executive_summary": "",
            "cross_layer_risks": [f"سنتز نهایی شکست خورد: {response.get('error')}"],
            "total_monthly_cost_usd_estimate": "",
            "build_order": [],
            "open_questions_for_owner": [],
            "cost_usd": 0.0,
        }
    parsed = _extract_json(response.get("content", ""))
    if parsed is None:
        return {
            "status": "FAILED",
            "executive_summary": _truncate(response.get("content", ""), 2000),
            "cross_layer_risks": ["پاسخ مدل سنتز نهایی JSON معتبر نبود."],
            "total_monthly_cost_usd_estimate": "",
            "build_order": [],
            "open_questions_for_owner": [],
            "cost_usd": response.get("cost_usd", 0.0),
        }
    parsed["status"] = "SUCCESS"
    parsed["model"] = response.get("model")
    parsed["cost_usd"] = response.get("cost_usd", 0.0)
    return parsed


def render_brief_markdown(idea: str, layers: list[dict[str, Any]], final: dict[str, Any], meta: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append(f"# 🧭 بریف فناوری پروژه: {idea}")
    lines.append("")
    lines.append(f"- **زمان تولید (UTC):** {meta.get('generated_at', '')}")
    lines.append(f"- **وضعیت کلی:** `{meta.get('status', 'UNKNOWN')}`")
    lines.append(f"- **رده مدل هر لایه:** `{PROJECT_BRIEF_LAYER_TIER}` — **رده مدل سنتز نهایی:** `{PROJECT_BRIEF_FINAL_TIER}`")
    lines.append(f"- **هزینه کل تخمینی اجرا (USD):** {meta.get('total_cost_usd', 0.0)}")
    lines.append(f"- **زمان کل اجرا (ثانیه):** {meta.get('elapsed_seconds', 0.0)}")
    lines.append("")

    if final.get("executive_summary"):
        lines.append("## خلاصه مدیریتی")
        lines.append(final["executive_summary"])
        lines.append("")

    if final.get("total_monthly_cost_usd_estimate"):
        lines.append(f"**برآورد هزینه ماهانه کل استک:** {final['total_monthly_cost_usd_estimate']}")
        lines.append("")

    if final.get("build_order"):
        lines.append("## ترتیب پیشنهادی ساخت")
        lines.extend(f"{i}. {step}" for i, step in enumerate(final["build_order"], start=1))
        lines.append("")

    if final.get("cross_layer_risks"):
        lines.append("## ریسک‌های بین‌لایه‌ای")
        lines.extend(f"- {r}" for r in final["cross_layer_risks"])
        lines.append("")

    lines.append("## توصیه به تفکیک لایه")
    lines.append("")
    for layer in layers:
        lines.append(f"### {layer['label_en']} — {layer['label_fa']} (`{layer['status']}`)")
        if layer.get("summary"):
            lines.append(layer["summary"])
        if layer.get("recommended"):
            lines.append(f"- **توصیه:** {layer['recommended']} — {layer.get('recommendation_reason', '')}")
        alts = layer.get("alternatives") or []
        if alts:
            lines.append("")
            lines.append("| گزینه | بلوغ | مجوز | امتیاز پذیرش | هزینه ماهانه | ریسک‌ها |")
            lines.append("| --- | --- | --- | --- | --- | --- |")
            for alt in alts:
                if not isinstance(alt, dict):
                    continue
                risks = "، ".join(alt.get("risks") or [])
                lines.append(
                    f"| {alt.get('name', '')} | {alt.get('maturity', '')} | {alt.get('license', '')} | "
                    f"{alt.get('adoption_score', '')} | {alt.get('monthly_cost_usd_estimate', '')} | {risks} |"
                )
        sources = layer.get("sources") or []
        if sources:
            lines.append("")
            lines.append("منابع: " + "، ".join(
                f"[{s.get('title') or s.get('url')}]({s.get('url')})"
                + (f" ({s.get('source_lang')})" if s.get("source_lang") not in (None, "", "en") else "")
                for s in sources
                if isinstance(s, dict) and s.get("url")
            ))
        lines.append("")

    if final.get("open_questions_for_owner"):
        lines.append("## سوالات باز برای مالک پروژه")
        lines.extend(f"- {q}" for q in final["open_questions_for_owner"])
        lines.append("")

    lines.append("---")
    lines.append("*این بریف به‌صورت خودکار توسط project-brief mode (TechRadarAgent، ROXIRA W9 Phase B) تولید شده است.*")
    return "\n".join(lines)


def run_project_brief(
    idea: str,
    out_path: pathlib.Path | None = None,
    multilingual: bool = True,
    report_lang: str = DEFAULT_REPORT_LANG,
    offline: bool = False,
    budget_guard: Optional[BudgetGuard] = None,
    layers: list[str] | None = None,
) -> dict[str, Any]:
    started = time.perf_counter()
    known_layer_keys = {layer.key for layer in LAYERS}
    for layer_id in layers or ():
        if layer_id not in known_layer_keys:
            raise ValueError(f"unknown layer: {layer_id}")
    research_layers = tuple(layer for layer in LAYERS if not layers or layer.key in layers)
    agent = TechRadarAgent(
        multilingual=multilingual,
        tier=PROJECT_BRIEF_LAYER_TIER,
        report_lang=report_lang,
        offline=offline,
    )

    layers: list[dict[str, Any]] = []
    budget_exceeded: BudgetExceeded | None = None
    for layer in research_layers:
        if budget_guard is not None and budget_exceeded is None:
            try:
                budget_guard.check(f"before layer '{layer.key}'")
            except BudgetExceeded as exc:
                budget_exceeded = exc
                logger.error("budget cap hit, aborting remaining layers: %s", exc)

        if budget_exceeded is not None:
            layers.append(
                {
                    "layer": layer.key,
                    "label_fa": layer.label_fa,
                    "label_en": layer.label_en,
                    "status": "FAILED",
                    "summary": "",
                    "alternatives": [],
                    "recommended": "",
                    "recommendation_reason": f"اجرا به دلیل عبور از سقف بودجه (--max-usd) متوقف شد: {budget_exceeded}",
                    "sources": [],
                    "cost_usd": 0.0,
                }
            )
            continue

        logger.info("researching layer: %s", layer.key)
        layers.append(_research_layer(agent, idea, layer, report_lang=report_lang))

    layer_statuses = {layer["status"] for layer in layers}
    if budget_exceeded is not None:
        # A cap hit mid-run must never be reported as anything but FAILED —
        # the final strong-tier reconciliation call never runs either.
        final = {
            "status": "FAILED",
            "executive_summary": "",
            "cross_layer_risks": [f"اجرا به دلیل عبور از سقف بودجه (--max-usd) متوقف شد: {budget_exceeded}"],
            "total_monthly_cost_usd_estimate": "",
            "build_order": [],
            "open_questions_for_owner": [],
            "cost_usd": 0.0,
        }
    elif layer_statuses == {"FAILED"}:
        # Every layer failed (almost certainly no search-provider keys at
        # all) — do not spend the strong-tier final call on zero evidence.
        final = {
            "status": "FAILED",
            "executive_summary": "",
            "cross_layer_risks": ["تمام لایه‌ها به دلیل نبود منبع یا شکست فراخوانی مدل ناموفق بودند."],
            "total_monthly_cost_usd_estimate": "",
            "build_order": [],
            "open_questions_for_owner": [],
            "cost_usd": 0.0,
        }
    else:
        try:
            if budget_guard is not None:
                budget_guard.check("before final project-brief synthesis")
            final = _final_synthesis(idea, layers, report_lang=report_lang)
        except BudgetExceeded as exc:
            logger.error("budget cap hit before final synthesis: %s", exc)
            final = {
                "status": "FAILED",
                "executive_summary": "",
                "cross_layer_risks": [f"اجرا به دلیل عبور از سقف بودجه (--max-usd) متوقف شد: {exc}"],
                "total_monthly_cost_usd_estimate": "",
                "build_order": [],
                "open_questions_for_owner": [],
                "cost_usd": 0.0,
            }

    total_cost = sum(layer.get("cost_usd", 0.0) for layer in layers) + final.get("cost_usd", 0.0)
    # Hard rule (owner brief): degraded/failed must never read as a clean
    # success — any layer or the final synthesis failing/degrading pulls the
    # whole brief's status down.
    overall_status = "SUCCESS"
    if "FAILED" in layer_statuses or final.get("status") == "FAILED":
        overall_status = "FAILED"
    elif "DEGRADED" in layer_statuses or final.get("status") == "DEGRADED":
        overall_status = "DEGRADED"

    meta = {
        "generated_at": _utc_now(),
        "status": overall_status,
        "total_cost_usd": round(total_cost, 6),
        "elapsed_seconds": round(time.perf_counter() - started, 2),
    }

    markdown = render_brief_markdown(idea, layers, final, meta)

    slug = _slugify(idea)
    out_path = out_path or (DEFAULT_BRIEFS_DIR / f"{slug}.md")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(markdown, encoding="utf-8")

    json_path = out_path.with_suffix(".json")
    payload = {
        "idea": idea,
        "slug": slug,
        **meta,
        "layers": layers,
        "final": final,
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")

    return {
        "idea": idea,
        "slug": slug,
        "status": overall_status,
        "total_cost_usd": meta["total_cost_usd"],
        "elapsed_seconds": meta["elapsed_seconds"],
        "markdown_path": str(out_path),
        "json_path": str(json_path),
        "layers": layers,
        "final": final,
    }
