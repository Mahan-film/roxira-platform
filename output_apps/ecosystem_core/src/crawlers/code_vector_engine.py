import os
import httpx
import logging
from typing import Dict, Any

logger = logging.getLogger("CodeVectorEngine")

class CodeVectorEngine:
    COLLECTION_NAME = "software_factory_code_vectors"

    @classmethod
    async def index_code_snippet(cls, snippet_id: int, file_path: str, code_content: str, metadata: Dict[str, Any]) -> bool:
        q_host = os.getenv("QDRANT_HOST", "roxira_qdrant_prod")
        q_port = os.getenv("QDRANT_PORT", "6333")
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                point = {
                    "id": snippet_id,
                    "payload": {
                        "file_path": file_path,
                        "code": code_content[:2000],
                        "module_type": metadata.get("module_type", "general"),
                        "dependencies": metadata.get("dependencies", [])
                    }
                }
                res = await client.put(
                    f"http://{q_host}:{q_port}/collections/{cls.COLLECTION_NAME}/points",
                    json={"points": [point]}
                )
                return res.status_code == 200
        except Exception as e:
            logger.error(f"Error indexing code: {e}")
            return False
