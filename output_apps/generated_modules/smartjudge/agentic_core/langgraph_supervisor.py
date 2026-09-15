"""
LangGraph-Inspired State Graph Orchestrator for SmartJudge Agentic Pipeline.
Implements cyclic execution, checkpointing, and self-healing verification loops.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field

logger = logging.getLogger("smartjudge.agentic.graph")


@dataclass
class AgenticState:
    conversation_id: str
    user_query: str
    current_node: str = "SUPERVISOR"
    intent: str = ""
    category: str = "general"
    extracted_entities: List[str] = field(default_factory=list)
    laws: List[Dict[str, Any]] = field(default_factory=list)
    precedents: List[Dict[str, Any]] = field(default_factory=list)
    draft_response: str = ""
    verified_response: str = ""
    retry_count: int = 0
    is_valid: bool = False
    audit_log: List[Dict[str, Any]] = field(default_factory=list)


class SmartJudgeGraphOrchestrator:
    """
    چرخه ایجنتیک خودترمیم برای پردازش پرونده‌های حقوقی:
    SUPERVISOR -> KNOWLEDGE_RETRIEVER -> REASONING_DRAFTER -> CRITIC_VERIFIER -> FINALIZER
    """

    def __init__(self, max_retries: int = 2):
        self.max_retries = max_retries

    async def supervisor_node(self, state: AgenticState) -> AgenticState:
        """تشخیص نیت، دسته‌بندی موضوعی و استخراج موجودیت‌های حقوقی."""
        t0 = time.time()
        q = state.user_query.lower()

        # تشخیص هوشمند حوزه‌های دعوا
        if any(w in q for w in ["مهریه", "نفقه", "طلاق", "زوجه", "حضانت", "عقد"]):
            state.category = "family_law"
            state.intent = "مطالبه حقوق مالی زوجه / دعاوی خانواده"
        elif any(w in q for w in ["ملک", "سند", "تخلیه", "سرقفلی", "مستأجر", "اجاره"]):
            state.category = "property_real_estate"
            state.intent = "دعاوی ملکی و استیجاری"
        elif any(w in q for w in ["چک", "سفته", "صیاد", "برگشت", "بانک"]):
            state.category = "negotiable_instruments"
            state.intent = "مطالبه وجه اسناد تجاری"
        elif any(w in q for w in ["کلاهبرداری", "خیانت در امانت", "سرقت", "جرم", "شکواییه"]):
            state.category = "criminal_penal"
            state.intent = "طرح شکواییه کیفری"
        else:
            state.category = "general"
            state.intent = "مشاوره حقوقی عمومی"

        state.audit_log.append({
            "node": "SUPERVISOR",
            "category": state.category,
            "latency_ms": round((time.time() - t0) * 1000, 2)
        })
        state.current_node = "KNOWLEDGE_RETRIEVER"
        return state

    async def knowledge_retriever_node(self, state: AgenticState, query_kg_func) -> AgenticState:
        """واکشی متصل به گراف دانش و پایگاه آرا دیوان عالی."""
        t0 = time.time()
        laws, precedents = query_kg_func(state.user_query)
        state.laws = laws or []
        state.precedents = precedents or []

        state.audit_log.append({
            "node": "KNOWLEDGE_RETRIEVER",
            "laws_found": len(state.laws),
            "precedents_found": len(state.precedents),
            "latency_ms": round((time.time() - t0) * 1000, 2)
        })
        state.current_node = "REASONING_DRAFTER"
        return state

    async def reasoning_drafter_node(self, state: AgenticState, llm_generate_func) -> AgenticState:
        """تدوین پاسخ استدلالی با استناد دقیق به مستندات قانونی."""
        t0 = time.time()
        law_summary = "، ".join([l.get("title", "") for l in state.laws[:2]]) if state.laws else "مقررات عمومی قانون مدنی"
        prec_summary = state.precedents[0].get("title", "") if state.precedents else "رویه قضایی دیوان عالی"

        prompt = (
            f"موضوع حقوقی: {state.user_query}\n"
            f"حوزه: {state.category}\n"
            f"مستندات قانونی معتبر: {law_summary}\n"
            f"آرای وحدت رویه: {prec_summary}\n"
            f"به عنوان قاضی هوشمند و وکیل پایه یک، پاسخی دقیق، سلیس، محترمانه و مستدل بنویسید."
        )

        response = await llm_generate_func(prompt)
        state.draft_response = response
        state.audit_log.append({
            "node": "REASONING_DRAFTER",
            "draft_length": len(response),
            "latency_ms": round((time.time() - t0) * 1000, 2)
        })
        state.current_node = "CRITIC_VERIFIER"
        return state

    async def critic_verifier_node(self, state: AgenticState) -> AgenticState:
        """حلقه خودترمیمی (Self-Healing Loop): اعتبارسنجی پاسخ و رد توهمات."""
        t0 = time.time()
        text = state.draft_response

        # قوانین سخت‌گیرانه برای جلوگیری از توهم
        has_substance = len(text.strip()) > 30
        no_forbidden_hallucinations = not any(w in text for w in ["ماده ۹۹۹۹", "دادگاه فدرال", "قانون اساسی آمریکا"])

        if has_substance and no_forbidden_hallucinations:
            state.is_valid = True
            state.verified_response = text
            state.current_node = "FINALIZER"
        else:
            state.retry_count += 1
            if state.retry_count <= self.max_retries:
                state.current_node = "REASONING_DRAFTER"  # حلقه بازگشت و اصلاح
            else:
                state.verified_response = text  # پذیرش با ثبت هشدار
                state.current_node = "FINALIZER"

        state.audit_log.append({
            "node": "CRITIC_VERIFIER",
            "is_valid": state.is_valid,
            "retry_count": state.retry_count,
            "latency_ms": round((time.time() - t0) * 1000, 2)
        })
        return state

    async def run(self, user_query: str, conv_id: str, query_kg_func, llm_generate_func) -> AgenticState:
        """اجرای کامل گراف حالت با قابلیت کنترل چرخه."""
        state = AgenticState(conversation_id=conv_id, user_query=user_query)

        while state.current_node != "FINALIZER":
            if state.current_node == "SUPERVISOR":
                state = await self.supervisor_node(state)
            elif state.current_node == "KNOWLEDGE_RETRIEVER":
                state = await self.knowledge_retriever_node(state, query_kg_func)
            elif state.current_node == "REASONING_DRAFTER":
                state = await self.reasoning_drafter_node(state, llm_generate_func)
            elif state.current_node == "CRITIC_VERIFIER":
                state = await self.critic_verifier_node(state)
            else:
                break

        return state
