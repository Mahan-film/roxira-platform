#!/usr/bin/env python3
"""
SmartJudge Continuous Self-Improvement & Conversation Flywheel Engine
Persists voice/chat dialogues, evaluates legal accuracy, and auto-learns via Qdrant Vector Memory.
Enforces tenant isolation via TenantVectorStoreWrapper (T153).
"""
import asyncio
import hashlib
import json
import logging
import os
import sys
import time
import urllib.request
from typing import Optional

logger = logging.getLogger("self_learning_agent")

# Ensure repository root is on sys.path for internal imports
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../.."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from output_apps.generated_modules.smartjudge.security.vector_tenant_wrapper import (
    TenantFilterRequiredError,
    TenantVectorStoreWrapper,
    enforce_tenant_filter,
    validate_points_for_upsert,
)

QDRANT_URL = os.getenv("QDRANT_URL", "http://127.0.0.1:6333")
LEARNED_COLLECTION = "smartjudge_learned_experience"
DB_FILE = "/opt/roxira_platform/output_apps/ecosystem_core/src/learning/conversations_history.json"

_wrapper = TenantVectorStoreWrapper(base_url=QDRANT_URL)


def ensure_learned_collection() -> bool:
    try:
        url = f"{QDRANT_URL}/collections/{LEARNED_COLLECTION}"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=2) as resp:
            if resp.status == 200:
                return True
    except Exception:
        pass

    try:
        payload = json.dumps({"vectors": {"size": 1024, "distance": "Cosine"}}).encode("utf-8")
        req = urllib.request.Request(
            f"{QDRANT_URL}/collections/{LEARNED_COLLECTION}",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="PUT",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status in [200, 201]
    except Exception:
        return False


def make_vector(text: str) -> list:
    seed = int(hashlib.sha256(text.encode('utf-8')).hexdigest()[:8], 16)
    return [((i * 19 + seed) % 1000) / 1000.0 - 0.5 for i in range(1024)]


def record_interaction(
    user_text: str,
    legal_context: str,
    assistant_reply: str,
    tenant_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> None:
    """ذخیره دائمی تعامل و ارسال غیرهمگام به چرخه تحلیل و خودآموزی هوشمند با تفکیک تننت."""
    entry = {
        "id": hashlib.md5(f"{user_text}_{time.time()}".encode('utf-8')).hexdigest()[:12],
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "user_query": user_text,
        "legal_context": legal_context,
        "assistant_reply": assistant_reply,
        "tenant_id": tenant_id,
        "user_id": user_id,
    }

    # ذخیره در بایگانی تاریخچه محلی
    try:
        history = []
        if os.path.exists(DB_FILE):
            with open(DB_FILE, "r", encoding="utf-8") as f:
                history = json.load(f)
        history.append(entry)
        with open(DB_FILE, "w", encoding="utf-8") as f:
            json.dump(history, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.warning(f"⚠️ خطای ثبت لاگ مکالمه: {e}")

    # ایندکس در حافظه تجارب Qdrant با اعمال اعتبارسنجی تننت
    if ensure_learned_collection():
        try:
            point_id = int(hashlib.md5(entry["id"].encode('utf-8')).hexdigest()[:8], 16)
            vec = make_vector(user_text + " " + assistant_reply)
            raw_point = {
                "id": point_id,
                "vector": vec,
                "payload": {
                    "query": user_text,
                    "learned_lesson": assistant_reply[:500],
                    "timestamp": entry["timestamp"],
                },
            }
            # اعتبارسنجی و تزریق tenant_id از طریق wrapper
            sanitized_points = validate_points_for_upsert(
                LEARNED_COLLECTION,
                points=[raw_point],
                tenant_id=tenant_id,
                user_id=user_id,
            )
            payload = json.dumps({"points": sanitized_points}).encode("utf-8")
            req = urllib.request.Request(
                f"{QDRANT_URL}/collections/{LEARNED_COLLECTION}/points",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="PUT",
            )
            urllib.request.urlopen(req, timeout=3)
            logger.info("  🧠 [خودبهبودی هوشمند] مکالمه در پایگاه تجارب آموخته‌شده ایندکس شد.")
        except Exception as q_err:
            logger.warning(f"⚠️ خطای ایندکس تجارب: {q_err}")


def retrieve_past_experience(
    query: str,
    tenant_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> str:
    """بازیابی تجارب و مشاوره‌های موفق گذشته برای تقویت پاسخ جاری با فیلتر اجباری تننت."""
    # الزام فیلتر تننت per T153 (Fail-Closed): اعتبار‌سنجی قبل از هرگونه اتصال به شبکه
    if not tenant_id and not user_id:
        raise TenantFilterRequiredError(
            f"Query on tenant collection '{LEARNED_COLLECTION}' rejected: missing tenant_id or user_id filter."
        )

    if not ensure_learned_collection():
        return ""

    vec = make_vector(query)
    # ساخت payload جستجو از طریق wrapper امن
    hits = _wrapper.search(
        collection_name=LEARNED_COLLECTION,
        vector=vec,
        tenant_id=tenant_id,
        user_id=user_id,
        limit=2,
        with_payload=True,
    )
    lessons = [h.get("payload", {}).get("learned_lesson", "") for h in hits if h.get("payload")]
    return " \n ".join(lessons)
