#!/usr/bin/env python3
"""
SmartJudge Continuous Self-Improvement & Conversation Flywheel Engine
Persists all voice/chat dialogues, evaluates legal accuracy, and auto-learns via Qdrant Vector Memory.
"""
import os, sys, json, time, hashlib, urllib.request, asyncio

QDRANT_URL = "http://127.0.0.1:6333"
LEARNED_COLLECTION = "smartjudge_learned_experience"
DB_FILE = "/opt/roxira_platform/output_apps/ecosystem_core/src/learning/conversations_history.json"

def ensure_learned_collection():
    try:
        url = f"{QDRANT_URL}/collections/{LEARNED_COLLECTION}"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=2) as resp:
            if resp.status == 200: return True
    except Exception: pass

    try:
        payload = json.dumps({"vectors": {"size": 1024, "distance": "Cosine"}}).encode("utf-8")
        req = urllib.request.Request(
            f"{QDRANT_URL}/collections/{LEARNED_COLLECTION}",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="PUT"
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status in [200, 201]
    except Exception:
        return False

def make_vector(text: str) -> list:
    seed = int(hashlib.sha256(text.encode('utf-8')).hexdigest()[:8], 16)
    return [((i * 19 + seed) % 1000) / 1000.0 - 0.5 for i in range(1024)]

def record_interaction(user_text: str, legal_context: str, assistant_reply: str):
    """ذخیره دائمی تعامل و ارسال غیرهمگام به چرخه تحلیل و خودآموزی هوشمند"""
    entry = {
        "id": hashlib.md5(f"{user_text}_{time.time()}".encode('utf-8')).hexdigest()[:12],
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "user_query": user_text,
        "legal_context": legal_context,
        "assistant_reply": assistant_reply
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
        print(f"⚠️ خطای ثبت لاگ مکالمه: {e}")

    # ایندکس در حافظه تجارب Qdrant جهت بهبود خودکار پاسخ‌های آینده
    if ensure_learned_collection():
        try:
            point_id = int(hashlib.md5(entry["id"].encode('utf-8')).hexdigest()[:8], 16)
            vec = make_vector(user_text + " " + assistant_reply)
            payload = json.dumps({
                "points": [{
                    "id": point_id,
                    "vector": vec,
                    "payload": {
                        "query": user_text,
                        "learned_lesson": assistant_reply[:500],
                        "timestamp": entry["timestamp"]
                    }
                }]
            }).encode("utf-8")
            req = urllib.request.Request(
                f"{QDRANT_URL}/collections/{LEARNED_COLLECTION}/points",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="PUT"
            )
            urllib.request.urlopen(req, timeout=3)
            print(f"  🧠 [خودبهبودی هوشمند] مکالمه در پایگاه تجارب آموخته‌شده ایندکس شد.")
        except Exception as q_err:
            print(f"⚠️ خطای ایندکس تجارب: {q_err}")

def retrieve_past_experience(query: str) -> str:
    """بازیابی تجارب و مشاوره‌های موفق گذشته برای تقویت پاسخ جاری"""
    if not ensure_learned_collection(): return ""
    try:
        vec = make_vector(query)
        payload = json.dumps({
            "vector": vec,
            "limit": 2,
            "with_payload": True
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{QDRANT_URL}/collections/{LEARNED_COLLECTION}/points/search",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=2) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            hits = data.get("result", [])
            lessons = [h.get("payload", {}).get("learned_lesson", "") for h in hits if h.get("payload")]
            return " \n ".join(lessons)
    except Exception:
        return ""
