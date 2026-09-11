import os
import sys
import pathlib

# افزودن خودکار ریشه مخزن به sys.path جهت اجرای مستقل و ایمن
REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from __future__ import annotations

import argparse
import concurrent.futures
import json
import logging
import pathlib
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from src.automation.provider_base import OpenAICompatibleClient, get_env_var
from src.automation.web_intelligence import WebIntelligence

logger = logging.getLogger("roxira.tech_radar")

PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_REPORT_MD = PROJECT_ROOT / "TECH_RADAR_REPORT.md"
DEFAULT_REPORT_JSON = PROJECT_ROOT / "TECH_RADAR_REPORT.json"
DEFAULT_HISTORY_DIR = PROJECT_ROOT / "data" / "tech_radar"

SYSTEM_PROMPT = (
    "You are the ROXIRA Chief Technology Scout. You synthesize live web intelligence into "
    "an executive, decision-grade technology radar. Ground every claim in the provided sources; "
    "never invent repositories, benchmarks or versions. Write the narrative in Persian (fa-IR) "
    "while keeping technology names, repository names and shell commands in their original English form. "
    "Respond ONLY with a single valid JSON object, no markdown fences."
)

REPORT_SCHEMA_HINT = """{
  "executive_summary": "چکیده مدیریتی ۳ تا ۵ جمله‌ای",
  "key_findings": ["یافته کلیدی ۱", "یافته کلیدی ۲"],
  "emerging_technologies": [
    {"name": "نام فناوری", "category": "دسته", "maturity": "emerging|growing|mainstream", "description": "توضیح", "why_it_matters": "چرا مهم است", "adoption_signal": "شاهد پذیرش"}
  ],
  "top_github_repositories": [
    {"name": "org/repo", "url": "https://github.com/org/repo", "stars": "تعداد تقریبی", "language": "زبان", "description": "توضیح", "why_relevant": "ارتباط با موضوع"}
  ],
  "pros_cons": [
    {"technology": "نام", "pros": ["مزیت"], "cons": ["عیب"], "best_for": "مناسب برای"}
  ],
  "suggested_commands": [
    {"purpose": "هدف", "command": "دستور اجرایی پوسته"}
  ],
  "risks_and_caveats": ["ریسک یا هشدار"],
  "recommendations": ["توصیه راهبردی"],
  "confidence": 0.0
}"""

FIELD_LIMITS = (
    "حداکثر ۸ فناوری در emerging_technologies، حداکثر ۶ مخزن در top_github_repositories، "
    "حداکثر ۵ مورد در pros_cons، حداکثر ۶ دستور در suggested_commands و حداکثر ۵ مورد در "
    "key_findings، risks_and_caveats و recommendations ثبت کن تا خروجی کامل و بدون بریدگی بماند."
)


class TechRadarLLM(OpenAICompatibleClient):
    BASE_URL = "https://openrouter.ai/api/v1"
    API_KEY_ENV = "OPENROUTER_API_KEY"
    DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash"
    HEALTH_PATH = "/models"
    CHAT_PATH = "/chat/completions"

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        default_model: Optional[str] = None,
        timeout: float = 120.0,
    ) -> None:
        super().__init__(
            api_key=api_key,
            base_url=base_url or get_env_var("OPENROUTER_BASE_URL", self.BASE_URL),
            default_model=default_model or get_env_var("DEFAULT_LLM_MODEL", self.DEFAULT_MODEL),
            timeout=timeout,
        )

    def _headers(self) -> Dict[str, str]:
        headers = super()._headers()
        headers["HTTP-Referer"] = "https://roxira.net"
        headers["X-Title"] = "ROXIRA Tech Radar"
        return headers


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _truncate(text: str, limit: int) -> str:
    text = (text or "").strip()
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


def _extract_json(raw: str) -> Optional[Dict[str, Any]]:
    if not raw:
        return None
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = "\n".join(
            line for line in cleaned.splitlines() if not line.strip().startswith("```")
        ).strip()
    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end > start:
        try:
            parsed = json.loads(cleaned[start : end + 1])
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            return None
    return None


class TechRadarAgent:
    """Autonomous multi-stage technology research and strategic reporting engine.

    Pipeline:
      1. Distributed neural search across Tavily / Exa / Brave.
      2. Clean page crawling via Firecrawl / Jina Reader.
      3. Cross-encoder reranking with Jina Reranker.
      4. Structured synthesis with deepseek-v4.1-flash via OpenRouter.
      5. Persistence to TECH_RADAR_REPORT.md and TECH_RADAR_REPORT.json.
    """

    def __init__(
        self,
        web: Optional[WebIntelligence] = None,
        llm: Optional[TechRadarLLM] = None,
        report_md: pathlib.Path = DEFAULT_REPORT_MD,
        report_json: pathlib.Path = DEFAULT_REPORT_JSON,
        history_dir: pathlib.Path = DEFAULT_HISTORY_DIR,
        max_workers: int = 6,
    ) -> None:
        self.web = web or WebIntelligence()
        self.llm = llm or TechRadarLLM()
        self.report_md = pathlib.Path(report_md)
        self.report_json = pathlib.Path(report_json)
        self.history_dir = pathlib.Path(history_dir)
        self.max_workers = max_workers

    # ------------------------------------------------------------------ search
    def _build_queries(self, topic: str, deep: bool) -> List[str]:
        base = [
            topic,
            f"{topic} github repositories",
            f"{topic} benchmark comparison 2026",
            f"{topic} production best practices",
        ]
        if not deep:
            return base[:3]
        base.extend(
            [
                f"{topic} architecture tradeoffs pros cons",
                f"{topic} state of the art September 2026",
                f"awesome list {topic} 2026",
            ]
        )
        return base

    def _distributed_search(self, queries: List[str], deep: bool) -> Dict[str, Any]:
        per_query = 8 if deep else 6
        aggregated: List[Dict[str, Any]] = []
        traces: List[Dict[str, Any]] = []
        seen: set[str] = set()
        for query in queries:
            response = self.web.search(query, max_results=per_query)
            traces.append(
                {
                    "query": query,
                    "status": response.get("status"),
                    "providers": response.get("providers"),
                    "count": len(response.get("results", [])),
                }
            )
            for item in response.get("results", []):
                url = (item.get("url") or "").strip()
                if not url or url in seen:
                    continue
                seen.add(url)
                aggregated.append(item)
        logger.info("search: %d unique results from %d queries", len(aggregated), len(queries))
        return {"queries": traces, "results": aggregated}

    # ------------------------------------------------------------------- crawl
    def _crawl_selected(self, results: List[Dict[str, Any]], deep: bool) -> List[Dict[str, Any]]:
        budget = 15 if deep else 6
        ordered = sorted(results, key=lambda item: float(item.get("score") or 0.0), reverse=True)
        targets = ordered[:budget]

        def crawl(item: Dict[str, Any]) -> Dict[str, Any]:
            url = item.get("url", "")
            content = item.get("content", "")
            title = item.get("title", "")
            engine = "search_snippet"
            scraped = self.web.scrape_clean_markdown(url)
            if scraped.get("status") == "SUCCESS" and scraped.get("markdown"):
                content = scraped["markdown"]
                title = scraped.get("title") or title
                engine = scraped.get("engine", "crawl")
            return {
                "title": title,
                "url": url,
                "content": content,
                "provider": item.get("provider", ""),
                "search_score": item.get("score", 0.0),
                "crawl_engine": engine,
            }

        documents: List[Dict[str, Any]] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers) as pool:
            for doc in pool.map(crawl, targets):
                if doc.get("content"):
                    documents.append(doc)
        logger.info("crawl: %d/%d pages captured", len(documents), len(targets))
        return documents

    # ------------------------------------------------------------------ rerank
    def _rerank(self, topic: str, documents: List[Dict[str, Any]], deep: bool) -> List[Dict[str, Any]]:
        if not documents:
            return []
        top_n = 10 if deep else 5
        payload = [
            {
                "title": doc.get("title", ""),
                "url": doc.get("url", ""),
                "content": _truncate(doc.get("content", ""), 3000),
            }
            for doc in documents
        ]
        response = self.web.rerank_documents(topic, payload, top_n=top_n, text_key="content")
        if response.get("status") != "SUCCESS":
            logger.warning("rerank unavailable, falling back to search order: %s", response.get("error"))
            ranked = sorted(documents, key=lambda d: d.get("search_score", 0.0), reverse=True)[:top_n]
            for doc in ranked:
                doc["relevance_score"] = doc.get("search_score", 0.0)
            return ranked

        ranked: List[Dict[str, Any]] = []
        for item in response.get("results", []):
            doc = item.get("document") or {}
            source = next((d for d in documents if d.get("url") == doc.get("url")), None)
            if source is None:
                continue
            enriched = dict(source)
            enriched["relevance_score"] = item.get("relevance_score", 0.0)
            ranked.append(enriched)
        return ranked or documents[:top_n]

    # --------------------------------------------------------------- synthesis
    def _build_context(self, sources: List[Dict[str, Any]], limit: int) -> str:
        blocks: List[str] = []
        used = 0
        for index, source in enumerate(sources, start=1):
            block = (
                f"[SOURCE {index}] {source.get('title', '')}\n"
                f"URL: {source.get('url', '')}\n"
                f"RELEVANCE: {source.get('relevance_score', 0.0)}\n"
                f"{_truncate(source.get('content', ''), 3500)}"
            )
            if used + len(block) > limit:
                break
            blocks.append(block)
            used += len(block)
        return "\n\n---\n\n".join(blocks)

    def _synthesize(
        self,
        topic: str,
        sources: List[Dict[str, Any]],
        search_bundle: Dict[str, Any],
        deep: bool,
    ) -> Dict[str, Any]:
        context = self._build_context(sources, 42000 if deep else 22000)
        source_index = "\n".join(
            f"- {s.get('title', '')} | {s.get('url', '')} | score={s.get('relevance_score', 0.0)}"
            for s in sources
        )
        prompt = (
            f"موضوع پژوهش: {topic}\n\n"
            f"پرس‌وجوهای انجام‌شده:\n"
            + "\n".join(f"- {q['query']}" for q in search_bundle.get("queries", []))
            + f"\n\nمنابع برگزیده (پس از رتبه‌بندی مجدد):\n{source_index}\n\n"
            f"محتوای خزش‌شده:\n{context}\n\n"
            "بر اساس صرفاً همین شواهد، یک گزارش راهبردی جامع بساز. "
            "خروجی را دقیقاً مطابق این اسکیمای JSON بازگردان:\n"
            f"{REPORT_SCHEMA_HINT}\n\n"
            "الزامات: همهٔ کلیدهای اسکیما باید در خروجی حاضر باشند. فیلدهای "
            "key_findings، emerging_technologies، top_github_repositories، pros_cons و "
            "suggested_commands نباید خالی بمانند. فیلد suggested_commands باید حداقل ۳ دستور "
            "اجرایی واقعی و قابل‌کپی (نصب، راه‌اندازی یا بنچمارک) مرتبط با موضوع و برگرفته از "
            "ریپازیتوری‌های معرفی‌شده باشد. فیلد confidence یک عدد اعشاری بین ۰ و ۱ است. "
            f"{FIELD_LIMITS}"
        )
        response = self.llm.chat(
            prompt=prompt,
            system_prompt=SYSTEM_PROMPT,
            temperature=0.2,
            max_tokens=8000 if deep else 6000,
            json_mode=True,
        )
        if response.get("status") != "SUCCESS":
            logger.error("synthesis failed: %s", response.get("error"))
            return {
                "status": "DEGRADED",
                "executive_summary": "سنتز مدل زبانی در دسترس نبود؛ خلاصه خام منابع ثبت شد.",
                "key_findings": [],
                "emerging_technologies": [],
                "top_github_repositories": [],
                "pros_cons": [],
                "suggested_commands": [],
                "risks_and_caveats": ["خروجی مدل سنتز ناموفق بود."],
                "recommendations": [],
                "confidence": 0.0,
                "raw_model_output": response.get("error"),
            }

        parsed = _extract_json(response.get("content", ""))
        if parsed is None:
            logger.warning("model returned non-JSON payload; storing raw")
            return {
                "status": "DEGRADED",
                "executive_summary": _truncate(response.get("content", ""), 2000),
                "key_findings": [],
                "emerging_technologies": [],
                "top_github_repositories": [],
                "pros_cons": [],
                "suggested_commands": [],
                "risks_and_caveats": ["پاسخ مدل ساختار JSON معتبر نداشت."],
                "recommendations": [],
                "confidence": 0.0,
                "raw_model_output": _truncate(response.get("content", ""), 8000),
            }
        parsed["status"] = "SUCCESS"
        parsed["model"] = response.get("model")
        parsed = self._normalize_analysis(parsed, topic)
        parsed = self._repair_analysis(parsed, topic, context)
        return parsed

    CRITICAL_FIELDS = (
        "emerging_technologies",
        "top_github_repositories",
        "pros_cons",
        "suggested_commands",
    )

    def _repair_analysis(
        self, analysis: Dict[str, Any], topic: str, context: str
    ) -> Dict[str, Any]:
        missing = [field for field in self.CRITICAL_FIELDS if not analysis.get(field)]
        if not missing:
            analysis["synthesis_attempts"] = 1
            return analysis

        attempts = 1
        for attempt in range(1, 3):
            attempts += 1
            logger.warning(
                "synthesis incomplete (attempt %d), repairing fields: %s",
                attempt,
                ", ".join(missing),
            )
            field_hint = "\n".join(f"- {field}" for field in missing)
            prompt = (
                f"موضوع پژوهش: {topic}\n\n"
                f"شواهد:\n{_truncate(context, 20000)}\n\n"
                "خروجی JSON مرحله قبل ناقص بود. فقط یک شیء JSON معتبر برگردان که دقیقاً و "
                f"صرفاً این کلیدها را داشته باشد: {missing}\n"
                "هر کلید باید آرایه‌ای غیرخالی و مبتنی بر شواهد بالا باشد. هیچ متن اضافه‌ای ننویس.\n"
                f"{FIELD_LIMITS}\n"
                f"کلیدهای الزامی:\n{field_hint}\n"
                f"برای مرجع ساختار از این اسکیما استفاده کن:\n{REPORT_SCHEMA_HINT}"
            )
            response = self.llm.chat(
                prompt=prompt,
                system_prompt=SYSTEM_PROMPT,
                temperature=0.1,
                max_tokens=6000,
                json_mode=True,
            )
            repaired = (
                _extract_json(response.get("content", ""))
                if response.get("status") == "SUCCESS"
                else None
            )
            if repaired:
                for field in missing:
                    value = repaired.get(field)
                    if value:
                        analysis[field] = value if isinstance(value, list) else [value]
            missing = [field for field in self.CRITICAL_FIELDS if not analysis.get(field)]
            if not missing:
                break

        if not analysis.get("suggested_commands"):
            analysis["suggested_commands"] = self._fallback_commands(analysis)
        analysis["synthesis_attempts"] = attempts
        return analysis

    @staticmethod
    def _fallback_commands(analysis: Dict[str, Any]) -> List[Dict[str, str]]:
        commands: List[Dict[str, str]] = []
        for repo in analysis.get("top_github_repositories") or []:
            if not isinstance(repo, dict):
                continue
            url = repo.get("url", "")
            name = repo.get("name", "") or url.rstrip("/").split("/")[-1]
            if url.startswith("https://github.com/"):
                commands.append(
                    {
                        "purpose": f"کلون و نصب {name}",
                        "command": f"git clone {url}.git && cd {name.split('/')[-1]} && pip install -e .",
                    }
                )
            if len(commands) >= 3:
                break
        return commands

    def _normalize_analysis(self, analysis: Dict[str, Any], topic: str) -> Dict[str, Any]:
        for key in (
            "key_findings",
            "emerging_technologies",
            "top_github_repositories",
            "pros_cons",
            "suggested_commands",
            "risks_and_caveats",
            "recommendations",
        ):
            if not isinstance(analysis.get(key), list):
                analysis[key] = [] if analysis.get(key) in (None, "") else [analysis[key]]
        confidence = analysis.get("confidence")
        try:
            confidence = float(confidence)
        except (TypeError, ValueError):
            confidence = 0.6
        analysis["confidence"] = max(0.0, min(1.0, confidence))
        if not analysis.get("executive_summary"):
            analysis["executive_summary"] = f"گزارش خودکار برای موضوع «{topic}» تولید شد."
        return analysis

    # ------------------------------------------------------------------ public
    def research(self, topic: str, deep: bool = False) -> Dict[str, Any]:
        started = time.perf_counter()
        queries = self._build_queries(topic, deep)
        search_bundle = self._distributed_search(queries, deep)
        pages = self._crawl_selected(search_bundle["results"], deep)
        ranked = self._rerank(topic, pages, deep)
        analysis = self._synthesize(topic, ranked, search_bundle, deep)

        report: Dict[str, Any] = {
            "topic": topic,
            "mode": "deep" if deep else "standard",
            "generated_at": _utc_now(),
            "elapsed_seconds": round(time.perf_counter() - started, 2),
            "engine": {
                "search": ["tavily", "exa", "brave"],
                "crawl": ["firecrawl", "jina-reader"],
                "rerank": "jina-reranker-v2-base-multilingual",
                "synthesis_model": self.llm.default_model,
            },
            "providers": self.web.providers(),
            "queries": [q["query"] for q in search_bundle["queries"]],
            "source_count": len(ranked),
            "sources": [
                {
                    "title": s.get("title", ""),
                    "url": s.get("url", ""),
                    "relevance_score": s.get("relevance_score", 0.0),
                    "crawl_engine": s.get("crawl_engine", ""),
                    "excerpt": _truncate(s.get("content", ""), 600),
                }
                for s in ranked
            ],
        }
        report.update(
            {
                key: analysis.get(key)
                for key in (
                    "status",
                    "model",
                    "executive_summary",
                    "key_findings",
                    "emerging_technologies",
                    "top_github_repositories",
                    "pros_cons",
                    "suggested_commands",
                    "risks_and_caveats",
                    "recommendations",
                    "confidence",
                    "synthesis_attempts",
                    "raw_model_output",
                )
                if key in analysis
            }
        )
        report["markdown"] = self.render_markdown(report)
        return report

    # --------------------------------------------------------------- rendering
    def render_markdown(self, report: Dict[str, Any]) -> str:
        lines: List[str] = []
        lines.append("# 🛰️ گزارش رادار فناوری ROXIRA")
        lines.append("")
        lines.append(f"- **موضوع پژوهش:** {report.get('topic', '')}")
        lines.append(f"- **حالت اجرا:** `{report.get('mode', 'standard')}`")
        lines.append(f"- **زمان تولید (UTC):** {report.get('generated_at', '')}")
        lines.append(f"- **مدل سنتز:** `{report.get('engine', {}).get('synthesis_model', '')}`")
        lines.append(f"- **تعداد منابع تحلیل‌شده:** {report.get('source_count', 0)}")
        lines.append(f"- **وضعیت:** `{report.get('status', 'UNKNOWN')}`")
        lines.append("")

        summary = report.get("executive_summary")
        if summary:
            lines.append("## خلاصه مدیریتی")
            lines.append(str(summary))
            lines.append("")

        findings = report.get("key_findings") or []
        if findings:
            lines.append("## یافته‌های کلیدی")
            lines.extend(f"- {item}" for item in findings)
            lines.append("")

        technologies = report.get("emerging_technologies") or []
        if technologies:
            lines.append("## فناوری‌های نوظهور و روندها")
            for tech in technologies:
                if not isinstance(tech, dict):
                    lines.append(f"- {tech}")
                    continue
                lines.append(f"### {tech.get('name', '')} — `{tech.get('maturity', '')}`")
                if tech.get("category"):
                    lines.append(f"- **دسته:** {tech['category']}")
                if tech.get("description"):
                    lines.append(f"- **توضیح:** {tech['description']}")
                if tech.get("why_it_matters"):
                    lines.append(f"- **اهمیت:** {tech['why_it_matters']}")
                if tech.get("adoption_signal"):
                    lines.append(f"- **شاهد پذیرش:** {tech['adoption_signal']}")
                lines.append("")

        repos = report.get("top_github_repositories") or []
        if repos:
            lines.append("## ریپازیتوری‌های برتر گیت‌هاب")
            lines.append("")
            lines.append("| مخزن | ستاره | زبان | چرا مهم است |")
            lines.append("| --- | --- | --- | --- |")
            for repo in repos:
                if not isinstance(repo, dict):
                    continue
                name = repo.get("name", "")
                url = repo.get("url", "")
                label = f"[{name}]({url})" if url else name
                lines.append(
                    f"| {label} | {repo.get('stars', '')} | {repo.get('language', '')} | "
                    f"{repo.get('why_relevant', '') or repo.get('description', '')} |"
                )
            lines.append("")

        pros_cons = report.get("pros_cons") or []
        if pros_cons:
            lines.append("## مزایا، معایب و موارد کاربرد")
            for item in pros_cons:
                if not isinstance(item, dict):
                    lines.append(f"- {item}")
                    continue
                lines.append(f"### {item.get('technology', '')}")
                pros = item.get("pros") or []
                cons = item.get("cons") or []
                if pros:
                    lines.append("**مزایا:**")
                    lines.extend(f"- {p}" for p in pros)
                if cons:
                    lines.append("")
                    lines.append("**معایب:**")
                    lines.extend(f"- {c}" for c in cons)
                if item.get("best_for"):
                    lines.append("")
                    lines.append(f"**مناسب برای:** {item['best_for']}")
                lines.append("")

        commands = report.get("suggested_commands") or []
        if commands:
            lines.append("## دستورات اجرایی پیشنهادی")
            for cmd in commands:
                if not isinstance(cmd, dict):
                    lines.append(f"```bash\n{cmd}\n```")
                    continue
                lines.append(f"**{cmd.get('purpose', '')}**")
                lines.append("```bash")
                lines.append(str(cmd.get("command", "")))
                lines.append("```")
                lines.append("")

        risks = report.get("risks_and_caveats") or []
        if risks:
            lines.append("## ریسک‌ها و هشدارها")
            lines.extend(f"- {item}" for item in risks)
            lines.append("")

        recommendations = report.get("recommendations") or []
        if recommendations:
            lines.append("## توصیه‌های راهبردی")
            lines.extend(f"- {item}" for item in recommendations)
            lines.append("")

        sources = report.get("sources") or []
        if sources:
            lines.append("## منابع")
            for source in sources:
                lines.append(
                    f"- [{source.get('title', '')}]({source.get('url', '')}) "
                    f"(relevance={source.get('relevance_score', 0.0)}, engine={source.get('crawl_engine', '')})"
                )
            lines.append("")

        lines.append("---")
        lines.append(
            "*این گزارش به‌صورت خودکار توسط TechRadarAgent (ROXIRA Autonomous Engineering Platform) تولید شده است.*"
        )
        return "\n".join(lines)

    # -------------------------------------------------------------- persistence
    def save(self, report: Dict[str, Any]) -> Dict[str, str]:
        markdown = report.get("markdown") or self.render_markdown(report)
        self.report_md.parent.mkdir(parents=True, exist_ok=True)
        self.report_md.write_text(markdown, encoding="utf-8")

        api_payload = {key: value for key, value in report.items() if key != "markdown"}
        self.report_json.parent.mkdir(parents=True, exist_ok=True)
        self.report_json.write_text(
            json.dumps(api_payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        self.history_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        history_file = self.history_dir / f"tech_radar_{stamp}.json"
        history_file.write_text(
            json.dumps(api_payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        return {
            "markdown": str(self.report_md),
            "json": str(self.report_json),
            "history": str(history_file),
        }

    def run(self, topic: str, deep: bool = False, persist: bool = True) -> Dict[str, Any]:
        logger.info("starting tech radar research: topic=%r deep=%s", topic, deep)
        report = self.research(topic, deep=deep)
        if persist:
            report["artifacts"] = self.save(report)
        return report

    # ------------------------------------------------------------------- digest
    def build_digest(self, reports: List[Dict[str, Any]], title: str) -> Dict[str, Any]:
        generated = _utc_now()
        markdown_sections: List[str] = []
        for report in reports:
            markdown_sections.append(report.get("markdown") or self.render_markdown(report))
        digest_markdown = "\n\n---\n\n".join(section.strip() for section in markdown_sections)
        header = [
            f"# 🛰️ {title}",
            "",
            f"- **زمان تولید (UTC):** {generated}",
            f"- **تعداد حوزه‌های پایش‌شده:** {len(reports)}",
            f"- **حوزه‌ها:** {', '.join(str(r.get('topic', '')) for r in reports)}",
            "",
            "---",
            "",
        ]
        return {
            "title": title,
            "generated_at": generated,
            "topic_count": len(reports),
            "topics": [r.get("topic", "") for r in reports],
            "reports": [{k: v for k, v in r.items() if k != "markdown"} for r in reports],
            "markdown": "\n".join(header) + digest_markdown,
        }

    def save_digest(self, reports: List[Dict[str, Any]], title: str) -> Dict[str, str]:
        digest = self.build_digest(reports, title)
        self.report_md.parent.mkdir(parents=True, exist_ok=True)
        self.report_md.write_text(digest["markdown"], encoding="utf-8")

        api_payload = {key: value for key, value in digest.items() if key != "markdown"}
        self.report_json.parent.mkdir(parents=True, exist_ok=True)
        self.report_json.write_text(
            json.dumps(api_payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        self.history_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        history_file = self.history_dir / f"digest_{stamp}.json"
        history_file.write_text(
            json.dumps(api_payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return {
            "markdown": str(self.report_md),
            "json": str(self.report_json),
            "history": str(history_file),
        }


def _configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="tech_radar",
        description="ROXIRA Tech Radar — live multi-stage technology research and strategic reporting.",
    )
    parser.add_argument("--topic", "-t", help="Research topic or prompt.")
    parser.add_argument(
        "--deep",
        action="store_true",
        help="Deep mode: more queries, more crawled pages and a larger synthesis budget.",
    )
    parser.add_argument(
        "--no-save", action="store_true", help="Do not persist TECH_RADAR_REPORT.md/.json."
    )
    parser.add_argument("--json", action="store_true", help="Print the JSON payload to stdout.")
    parser.add_argument(
        "--merge-dir",
        help="Merge all *.json radar reports in this directory into a consolidated digest.",
    )
    parser.add_argument(
        "--title",
        default="ROXIRA Daily Technology Scout",
        help="Title used for the merged digest report.",
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="Enable debug logging.")
    return parser


def _load_reports(directory: str) -> List[Dict[str, Any]]:
    reports: List[Dict[str, Any]] = []
    for path in sorted(pathlib.Path(directory).glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("skipping %s: %s", path, exc)
            continue
        if isinstance(data, dict) and data.get("topic"):
            reports.append(data)
    return reports


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    _configure_logging(args.verbose)
    agent = TechRadarAgent()

    if args.merge_dir:
        reports = _load_reports(args.merge_dir)
        if not reports:
            logger.error("no valid radar reports found in %s", args.merge_dir)
            return 1
        artifacts = agent.save_digest(reports, args.title)
        logger.info("digest written: %s (%d topics)", artifacts["markdown"], len(reports))
        logger.info("json written:   %s", artifacts["json"])
        return 0

    if not args.topic:
        parser.error("--topic is required unless --merge-dir is used")

    report = agent.run(args.topic, deep=args.deep, persist=not args.no_save)

    if args.json:
        print(json.dumps({k: v for k, v in report.items() if k != "markdown"}, ensure_ascii=False, indent=2))
    elif args.no_save:
        print(report.get("markdown", ""))
    else:
        artifacts = report.get("artifacts", {})
        logger.info("report written: %s", artifacts.get("markdown"))
        logger.info("json written:   %s", artifacts.get("json"))
        logger.info("history:        %s", artifacts.get("history"))
    return 0 if report.get("status") in ("SUCCESS", "DEGRADED") else 1


if __name__ == "__main__":
    raise SystemExit(main())
