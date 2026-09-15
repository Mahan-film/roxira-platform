"""
PydanticAI-Compatible Type-Safe Schemas for SmartJudge Agentic Pipeline.
Ensures deterministic, structured outputs for legal analysis and autonomous execution.
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class CaseCategory(str, Enum):
    FAMILY = "family_law"  # مهریه، نفقه، طلاق، حضانت
    PROPERTY = "property_real_estate"  # سرقفلی، تخلیه، الزام به تنظیم سند، ثبتی
    CRIMINAL = "criminal_penal"  # کلاهبرداری، خیانت در امانت، چک کیفری، تصرف عدوانی
    CONTRACTS = "commercial_contracts"  # قراردادهای مشارکت، پیمانکاری، بیع، اجاره
    CHEQUE_FINANCIAL = "negotiable_instruments"  # چک صیادی، سفته، برات، اعسار
    LABOR = "labor_social_security"  # روابط کارگر و کارفرما، بیمه تامین اجتماعی


class StatutoryReference(BaseModel):
    node_id: str = Field(description="Unique identifier in Knowledge Graph")
    title: str = Field(description="عنوان قانون یا ماده (مانند ماده ۱۰۸۲ قانون مدنی)")
    category: str = Field(default="عمومی")
    summary: str = Field(description="خلاصه حکم ماده قانونی")
    match_level: str = Field(default="HIGH_DOCTRINE")


class PrecedentReference(BaseModel):
    node_id: str = Field(description="شناسه رأی وحدت رویه یا نشست قضایی")
    title: str = Field(description="شماره و عنوان رأی دیوان عالی کشور")
    subject: str = Field(default="وحدت رویه")
    summary: str = Field(description="پیام اصلی و استدلال حاکم در رأی")
    match_level: str = Field(default="HIGH_ACTIVE_PRECEDENT")


class LegalRiskFactor(BaseModel):
    title: str = Field(description="عنوان ریسک حقوقی")
    severity: str = Field(description="شدت ریسک: LOW, MEDIUM, HIGH, CRITICAL")
    mitigation_strategy: str = Field(description="راهکار تعدیل و ایمن‌سازی حقوقی")


class AgenticConsultResult(BaseModel):
    conversation_id: str
    user_query: str
    primary_intent: str
    category: CaseCategory
    statutory_basis: List[StatutoryReference] = Field(default_factory=list)
    unified_precedents: List[PrecedentReference] = Field(default_factory=list)
    risk_factors: List[LegalRiskFactor] = Field(default_factory=list)
    success_probability: Optional[str] = None
    actionable_advice: str
    formal_defense_draft: Optional[str] = None
    execution_steps: List[str] = Field(default_factory=list)
    confidence_score: float = Field(default=0.95, ge=0.0, le=1.0)
    agentic_state: str = Field(default="VERIFIED")
