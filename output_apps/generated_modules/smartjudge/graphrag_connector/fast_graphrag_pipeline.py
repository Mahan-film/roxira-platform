"""
Fast-GraphRAG to Real-Time Voice Streaming Pipeline.
Traverses the Judicial Knowledge Graph in under 50ms and injects legal grounding
directly into the streaming LLM prompt during a live voice call.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass

logger = logging.getLogger("smartjudge.graphrag_voice")


@dataclass
class GroundedVoiceContext:
    statutory_citations: List[str]
    precedent_citations: List[str]
    system_grounding_prompt: str
    graph_lookup_latency_ms: float


class FastGraphRAGVoiceConnector:
    """اتصال پایگاه دانش گراف قضایی به پایپلاین صوتی زنده با تأخیر فوق‌پایین."""

    def __init__(self, query_kg_func):
        self.query_kg_func = query_kg_func

    async def retrieve_voice_context(self, user_spoken_turn: str) -> GroundedVoiceContext:
        """
        استخراج سریع موجودیت‌های حقوقی و تزریق استنادها در حین شروع پاسخ صوتی.
        """
        t0 = time.time()

        # اجرای ناهمگام استعلام گراف جهت جلوگیری از مسدود شدن استریم صدا
        loop = asyncio.get_event_loop()
        laws, precedents = await loop.run_in_executor(None, self.query_kg_func, user_spoken_turn)

        latency = round((time.time() - t0) * 1000, 2)

        statute_titles = [l.get("title", "") for l in (laws or [])[:3] if l.get("title")]
        precedent_titles = [p.get("title", "") for p in (precedents or [])[:2] if p.get("title")]

        grounding_text = ""
        if statute_titles:
            grounding_text += f"\nمستندات قانونی حاکم: {' ، '.join(statute_titles)}"
        if precedent_titles:
            grounding_text += f"\nآرای وحدت رویه دیوان عالی: {' ، '.join(precedent_titles)}"

        system_prompt = (
            "شما قاضی هوشمند و دستیار صوتی حقوقی هستید. "
            "پاسخ را بسیار موجز، دقیق، محترمانه و مناسب مکالمه زنده تلفنی بیان کنید. "
            f"{grounding_text}"
        )

        return GroundedVoiceContext(
            statutory_citations=statute_titles,
            precedent_citations=precedent_titles,
            system_grounding_prompt=system_prompt,
            graph_lookup_latency_ms=latency
        )
