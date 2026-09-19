#!/usr/bin/env python3
"""
Roxira Research Memory Agent (Qdrant Vector DB Integration)
Automatically indexes completed research reports and queries existing organizational knowledge.
"""
import os, json, urllib.request, hashlib

QDRANT_URL = "http://127.0.0.1:6333"
COLLECTION_NAME = "research_knowledge_base"

def ensure_collection():
    try:
        url = f"{QDRANT_URL}/collections/{COLLECTION_NAME}"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=3) as resp:
            if resp.status == 200: return True
    except Exception:
        pass

    try:
        payload = json.dumps({
            "vectors": {"size": 1024, "distance": "Cosine"}
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{QDRANT_URL}/collections/{COLLECTION_NAME}",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="PUT"
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status in [200, 201]
    except Exception as e:
        print(f"⚠️ خطای ساخت کالکشن Qdrant: {e}")
        return False

def index_research_artifact(task_id: str, prompt: str, summary: str, domain: str):
    """ذخیره برداری خلاصه گزارش و متاداده ماژول در حافظه Qdrant"""
    if not ensure_collection(): return False
    try:
        # ایجاد شناسه عددی یکتا از task_id
        point_id = int(hashlib.md5(task_id.encode('utf-8')).hexdigest()[:8], 16)
        
        # بردار شبیه‌سازی‌شده تعبیه‌سازی سازگار با مدل bge-m3 (1024 بعدی)
        dummy_vector = [((i * 7 + point_id) % 100) / 100.0 - 0.5 for i in range(1024)]
        
        payload = json.dumps({
            "points": [{
                "id": point_id,
                "vector": dummy_vector,
                "payload": {
                    "task_id": task_id,
                    "prompt": prompt,
                    "domain": domain,
                    "summary": summary[:1000]
                }
            }]
        }).encode("utf-8")
        
        req = urllib.request.Request(
            f"{QDRANT_URL}/collections/{COLLECTION_NAME}/points",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="PUT"
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status in [200, 201]
    except Exception as e:
        print(f"⚠️ خطای ثبت در Qdrant: {e}")
        return False
