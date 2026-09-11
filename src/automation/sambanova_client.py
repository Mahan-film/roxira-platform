from __future__ import annotations

import json
from typing import Any, Dict, Optional

from src.automation.provider_base import OpenAICompatibleClient, get_env_var

OPENAPI_SYSTEM_PROMPT = (
    "You are the ROXIRA contract-first architect. Produce a valid OpenAPI 3.1.0 JSON document. "
    "Every endpoint must reference a dedicated request/response DTO schema. Respond ONLY with JSON."
)

DTO_SYSTEM_PROMPT = (
    "You are the ROXIRA DTO architect. Produce Pydantic v2 models with class-validator style "
    "constraints as JSON schema. Respond ONLY with a JSON object mapping model name to JSON schema."
)


class SambaNovaClient(OpenAICompatibleClient):
    BASE_URL = "https://api.sambanova.ai/v1"
    API_KEY_ENV = "SAMBANOVA_API_KEY"
    DEFAULT_MODEL = "DeepSeek-V3.2"

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        default_model: Optional[str] = None,
        timeout: float = 45.0,
    ) -> None:
        super().__init__(
            api_key=api_key,
            base_url=base_url or get_env_var("SAMBANOVA_BASE_URL", self.BASE_URL),
            default_model=(
                default_model or get_env_var("SAMBANOVA_CONTRACT_MODEL", self.DEFAULT_MODEL)
            ),
            timeout=timeout,
        )

    def _structured(self, prompt: str, system_prompt: str) -> Dict[str, Any]:
        response = self.chat(
            prompt=prompt,
            system_prompt=system_prompt,
            temperature=0.1,
            max_tokens=4096,
            json_mode=True,
        )
        if response.get("status") != "SUCCESS":
            return response
        raw = response["content"]
        lines = [line for line in raw.splitlines() if not line.strip().startswith("```")]
        cleaned = "\n".join(lines).strip()
        try:
            response["content"] = json.loads(cleaned)
        except json.JSONDecodeError:
            return {
                "status": "ERROR",
                "error": "SambaNova response was not valid JSON",
                "raw": cleaned[:1000],
            }
        return response

    def generate_openapi_contract(
        self,
        module_name: str,
        category: str,
        features: list[str],
        router_prefix: str = "/api/v1/apps",
        source_code: str = "",
    ) -> Dict[str, Any]:
        if not self.configured:
            return {"status": "ERROR", "error": f"{self.API_KEY_ENV} is missing"}
        prompt = (
            f"Module: {module_name}\nCategory: {category}\n"
            f"Features: {', '.join(features)}\nRouter prefix: {router_prefix}\n"
            f"Source code:\n{source_code[:8000]}\n\n"
            "Return the full OpenAPI 3.1.0 JSON document for this module."
        )
        return self._structured(prompt, OPENAPI_SYSTEM_PROMPT)

    def generate_dto_schema(
        self,
        module_name: str,
        category: str,
        features: list[str],
        source_code: str = "",
    ) -> Dict[str, Any]:
        if not self.configured:
            return {"status": "ERROR", "error": f"{self.API_KEY_ENV} is missing"}
        prompt = (
            f"Module: {module_name}\nCategory: {category}\n"
            f"Features: {', '.join(features)}\n"
            f"Source code:\n{source_code[:8000]}\n\n"
            "Return JSON schemas for every request and response DTO used by this module."
        )
        return self._structured(prompt, DTO_SYSTEM_PROMPT)
