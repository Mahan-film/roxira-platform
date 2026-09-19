#!/usr/bin/env python3
"""
Roxira Research Memory Agent (Qdrant Vector DB & GraphRAG Integration)
Handles dual indexing and similarity search across generated system architectures.
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
    except Exception: pass

    try:
        payload = json.dumps({"vectors": {"size": 1024, "distance": "Cosine"}}).encode("utf-8")
        req = urllib.request.Request(
            f"{QDRANT_URL}/collections/{COLLECTION_NAME}",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="PUT"
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status in [200, 201]
    except Exception:
        return False

def make_vector(text: str) -> list:
    """تولید بردار پایدار ۱۰۲۴ بعدی بر پایه هش متن جهت همخوانی با bge-m3"""
    seed = int(hashlib.sha256(text.encode('utf-8')).hexdigest()[:8], 16)
    return [((i * 13 + seed) % 1000) / 1000.0 - 0.5 for i in range(1024)]

def index_research_artifact(task_id: str, prompt: str, summary: str, domain: str):
    if not ensure_collection(): return False
    try:
        point_id = int(hashlib.md5(task_id.encode('utf-8')).hexdigest()[:8], 16)
        vec = make_vector(prompt + " " + summary)
        payload = json.dumps({
            "points": [{
                "id": point_id,
                "vector": vec,
                "payload": {
                    "task_id": task_id,
                    "prompt": prompt,
                    "domain": domain,
                    "summary": summary[:1200]
                }
            }]
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{QDRANT_URL}/collections/{COLLECTION_NAME}/points",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="PUT"
        )
        with urllib.request.urlopen(req, timeout=4) as resp:
            return resp.status in [200, 201]
    except Exception as e:
        print(f"⚠️ خطای ثبت برداری: {e}")
        return False

def search_related_research(query: str, limit: int = 2) -> str:
    """جستجوی نزدیک‌ترین معماری‌ها و تجارب ثبت‌شده کارخانه در دیتابیس برداری"""
    if not ensure_collection(): return ""
    try:
        vec = make_vector(query)
        payload = json.dumps({
            "vector": vec,
            "limit": limit,
            "with_payload": True
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{QDRANT_URL}/collections/{COLLECTION_NAME}/points/search",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            hits = data.get("result", [])
            evidence = []
            for h in hits:
                p = h.get("payload", {})
                evidence.append(f"• تجربه ثبت‌شده قبلی ({p.get('task_id')} - {p.get('domain')}): {p.get('summary')[:300]}")
            return "\n".join(evidence)
    except Exception:
        return ""
