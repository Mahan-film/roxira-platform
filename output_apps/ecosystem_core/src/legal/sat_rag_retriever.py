import os
import httpx
from typing import Dict, Any, List

QDRANT_HOST = os.getenv("QDRANT_HOST", "roxira_qdrant_prod")
QDRANT_PORT = os.getenv("QDRANT_PORT", "6333")

class SATGraphRAGRetriever:
    @classmethod
    async def retrieve_relevant_statutes(cls, query: str, event_date: str = "2024-01-01") -> List[Dict[str, Any]]:
        hosts = [QDRANT_HOST, "qdrant_prod", "127.0.0.1", "localhost"]
        port = QDRANT_PORT
        
        # جستجوی معنایی در Qdrant
        async with httpx.AsyncClient(timeout=10.0) as client:
            for host in hosts:
                try:
                    # کوئری دریافت نقاط با فیلتر زمانی
                    url = f"http://{host}:{port}/collections/iran_laws_bge_m3/points/scroll"
                    res = await client.post(url, json={"limit": 10, "with_payload": True})
                    if res.status_code == 200:
                        points = res.json().get("result", {}).get("points", [])
                        valid_results = []
                        for p in points:
                            payload = p.get("payload", {})
                            valid_start = payload.get("valid_start", "1900-01-01")
                            valid_end = payload.get("valid_end")
                            
                            # ارزیابی فرمول زمانی LRMoo: valid_start <= t < valid_end
                            is_valid = (valid_start <= event_date) and (valid_end is None or valid_end > event_date)
                            if is_valid:
                                valid_results.append(payload)
                        return valid_results
                except Exception:
                    continue
        return []
