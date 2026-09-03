import os
import httpx
from typing import Dict, Any

QDRANT_HOST = os.getenv("QDRANT_HOST", "roxira_qdrant_prod")
QDRANT_PORT = os.getenv("QDRANT_PORT", "6333")
BASE_URL = f"http://{QDRANT_HOST}:{QDRANT_PORT}"

async def setup_qdrant_collections():
    collections = ["iran_laws_bge_m3", "software_factory_code_vectors", "judicial_precedents"]
    results = {}
    async with httpx.AsyncClient(timeout=10.0) as client:
        for col in collections:
            try:
                res = await client.get(f"{BASE_URL}/collections/{col}")
                if res.status_code == 404:
                    # ساخت کالکشن برداری با ابعاد ۱۰۲۴ (استاندارد BGE-M3)
                    create_payload = {
                        "vectors": {
                            "size": 1024,
                            "distance": "Cosine"
                        }
                    }
                    create_res = await client.put(f"{BASE_URL}/collections/{col}", json=create_payload)
                    results[col] = "CREATED" if create_res.status_code == 200 else "FAILED"
                else:
                    results[col] = "ALREADY_EXISTS"
            except Exception as e:
                results[col] = f"ERROR: {str(e)}"
    return results
