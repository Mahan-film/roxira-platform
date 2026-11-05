import asyncio
import os
import re
import pathlib
import logging
import sys
from typing import Dict, Any, List

import httpx

logger = logging.getLogger("RoxiraFactoryCore")
OUT_DIR = pathlib.Path("/app/output_apps/generated_modules")


def _llm_route():
    root = pathlib.Path(__file__).resolve().parents[4]
    dev = str(root / "scripts" / "dev")
    if dev not in sys.path:
        sys.path.insert(0, dev)
    import llm_route

    return llm_route


class RoxiraSoftwareFactory:
    @classmethod
    def extract_clean_code(cls, text: str) -> str:
        blocks = re.findall(r"```(?:python)?\s*(.*?)\s*```", text, re.DOTALL | re.IGNORECASE)
        if blocks:
            return "\n\n".join(b.strip() for b in blocks if b.strip())
        lines = []
        for line in text.splitlines():
            if not line.strip().startswith("```"):
                lines.append(line)
        return "\n".join(lines).strip()

    @classmethod
    async def retrieve_code_patterns(cls, query: str) -> str:
        q_host = os.getenv("QDRANTT_HOST", "roxira_qdrant_prod")
        q_port = os.getenv("QDRANT_PORT", "6333")
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                res = await client.post(
                    f"http://{q_host}:{q_port}/collections/software_factory_code_vectors/points/scroll",
                    json={"limit": 2, "with_payload": True}
                )
                if res.status_code == 200:
                    points = res.json().get("result", {}).get("points", [])
                    snippets = [p.get("payload", {}).get("snippet", "") for p in points if p.get("payload")]
                    return "\n---\n".join(snippets[:1])
        except Exception:
            pass
        return ""

    @classmethod
    async def synthesize_and_save_module(cls, module_name: str, category: str, features: List[str], framework: str = "FastAPI") -> Dict[str, Any]:
        target = OUT_DIR / module_name.lower()
        target.mkdir(parents=True, exist_ok=True)
        feat_str = ", ".join(features)
        context = await cls.retrieve_code_patterns(f"{module_name} {category}")
        sys_prompt = f"You are Chief Software Architect for Roxira OS. Design complete enterprise module {module_name} ({category}) with features: {feat_str}. Requirements: Python 3.12+, SQLAlchemy 2.0 Async, Pydantic v2 schemas, FastAPI router endpoints. Deployable code only.\nContext:\n{context[:1000]}"
        user_prompt = f"Write complete Python code for {module_name}."
        messages = [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user_prompt},
        ]

        llm_route = _llm_route()
        try:
            result = await asyncio.to_thread(
                llm_route.route,
                "fleet",
                messages,
                llm_route.attempts_for("fleet", timeout=120.0),
                max_tokens=4096,
                public=True,
            )
        except (llm_route.AllAttemptsFailed, llm_route.CapReached) as exc:
            return {"status": "error", "message": "Inference failed", "details": str(exc)}

        pure = cls.extract_clean_code(result.text)
        out = target / f"{module_name.lower()}_module.py"
        out.write_text(pure, encoding="utf-8")
        return {
            "status": "success",
            "module": module_name,
            "category": category,
            "file_name": out.name,
            "saved_path": f"/opt/roxira_platform/output_apps/generated_modules/{module_name.lower()}/{out.name}",
            "model_used": result.served,
        }
