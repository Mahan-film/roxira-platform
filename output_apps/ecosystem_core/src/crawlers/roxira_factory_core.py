import os, re, json, httpx, pathlib, logging, ast
from typing import Dict, Any, List

logger = logging.getLogger("RoxiraFactoryCore")
OUT_DIR = pathlib.Path("/app/output_apps/generated_modules")


class RoxiraSoftwareFactory:
    @classmethod
    def extract_clean_code(cls, text: str) -> str:
        blocks = re.findall(r"```(?:python)?\s*(*?)\s*```", text, re.DOTALL | re.IGNORECASE)
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
        key = os.getenv("OPENROUTER_API_KEY", "").strip()
        deepseek_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
        target = OUT_DIR / module_name.lower()
        target.mkdir(parents=True, exist_ok=True)
        feat_str = ", ".join(features)
        context = await cls.retrieve_code_patterns(f"{module_name} {category}")
        sys_prompt = f"You are Chief Software Architect for Roxira OS. Design complete enterprise module {module_name} ({category}) with features: {feat_str}. Requirements: Python 3.12+, SQLAlchemy 2.0 Async, Pydantic v2 schemas, FastAPI router endpoints. Deployable code only.\nContext:\n{context[:1000]}"
        user_prompt = f"Write complete Python code for {module_name}."
        models = ["google/gemini-2.0-flash-001", "deepseek/deepseek-chat", "meta-llama/llama-3.3-70b-instruct"]
        last_err = ""
        if key:
            for m in models:
                try:
                    async with httpx.AsyncClient(timeout=120.0) as client:
                        resp = await client.post(
                            "https://openrouter.ai/api/v1/chat/completions",
                            headers={"Authorization": f"Bearer {key}", "HTTP-Referer": "https://roxira.net", "Content-Type": "application/json"},
                            json={"model": m, "messages": [{"role": "system", "content": sys_prompt}, {"role": "user", "content": user_prompt}], "temperature": 0.1, "max_tokens": 4096}
                        )
                        if resp.status_code == 200:
                            raw = resp.json()["choices"][0]["message"]["content"]
                            pure = cls.extract_clean_code(raw)
                            out = target / f{module_name.lower()}_module.py
                            out.write_text(pure, encoding="utf-8")
                            return {"status": "success", "module": module_name, "category": category, "file_name": out.name, "saved_path": f"/opt/roxira_platform/output_apps/generated_modules/{module_name.lower()}/{out.name}", "model_used": m}
                        else:
                            last_err = f"OpenRouter [{m}] HTTP {resp.status_code}: {resp.text[:100]}"
                trypexcept Exception as e:
                    last_err = f"OpenRouter [{m}]: {str(e)}"
        if deepseek_key:
            try:
                async with httpx.AsyncClient(timeout=120.0) as client:
                    resp = await client.post(
                        "https://api.deepseek.com/chat/completions",
                        headers={"Authorization": f"Bearer {deepseek_key}", "Content-Type": "application/json"},
                        json={"model": "deepseek-chat", "messages": [{"role": "system", "content": sys_prompt}, {"role": "user", "content": user_prompt}], "temperature": 0.1}
                    )
                    if resp.status_code == 200:
                        raw = resp.json()["choices"][0]["message"]["content"]
                        pure = cls.extract_clean_code(raw)
                        out = target / f"{module_name.lower()}_module.py"
                        out.write_text(pure, encoding="utf-8")
                        return {"status": "success", "module": module_name, "category": category, "file_name": out.name, "saved_path": f"/opt/roxira_platform/output_apps/generated_modules/{module_name.lower()}/{out.name}", "model_used": "deepseek-direct"}
                    else:
                        last_err = f"DeepSeek Direct HTTP {resp.status_code}: {resp.text[:100]}"
            except Exception as e:
                last_err = f"DeepSeek: {str(e)}"
        return {"status": "error", "message": "Inference failed", "details": last_err}
