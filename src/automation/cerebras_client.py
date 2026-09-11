from __future__ import annotations

import ast
import json
from typing import Any, Dict, List, Optional

from src.automation.provider_base import OpenAICompatibleClient, get_env_var

SYNTAX_SYSTEM_PROMPT = (
    "You are a senior Python 3.12 and FastAPI linter (LSP engine). "
    "Analyze the given code for syntax errors, undefined names, broken imports, "
    "unreachable code and API contract mismatches. "
    "Respond ONLY with a JSON object: "
    '{"valid": bool, "issues": [{"line": int, "severity": "error|warning", "message": str}]}'
)


class CerebrasClient(OpenAICompatibleClient):
    BASE_URL = "https://api.cerebras.ai/v1"
    API_KEY_ENV = "CEREBRAS_API_KEY"
    DEFAULT_MODEL = "qwen-3.8-27b"

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        default_model: Optional[str] = None,
        timeout: float = 20.0,
    ) -> None:
        super().__init__(
            api_key=api_key,
            base_url=base_url or get_env_var("CEREBRAS_BASE_URL", self.BASE_URL),
            default_model=default_model or get_env_var("CEREBRAS_CODE_MODEL", self.DEFAULT_MODEL),
            timeout=timeout,
        )

    @staticmethod
    def local_syntax_check(code: str) -> Dict[str, Any]:
        issues: List[Dict[str, Any]] = []
        try:
            tree = ast.parse(code)
            compile(tree, "<factory>", "exec")
            return {"valid": True, "issues": issues}
        except SyntaxError as exc:
            issues.append({
                "line": exc.lineno or 0,
                "severity": "error",
                "message": f"{exc.msg}",
            })
            return {"valid": False, "issues": issues}
        except ValueError as exc:
            issues.append({"line": 0, "severity": "error", "message": str(exc)})
            return {"valid": False, "issues": issues}

    def check_syntax(self, code: str, language: str = "python") -> Dict[str, Any]:
        if language == "python":
            local = self.local_syntax_check(code)
        else:
            local = {"valid": True, "issues": []}
        result: Dict[str, Any] = {
            "status": "SUCCESS" if local["valid"] else "INVALID",
            "engine": "cerebras",
            "language": language,
            "valid": local["valid"],
            "local": local,
            "ai": None,
            "issues": list(local["issues"]),
        }

        if not self.configured:
            result["status"] = "LOCAL_ONLY"
            result["note"] = f"{self.API_KEY_ENV} not configured"
            return result

        ai_response = self.chat(
            prompt=f"Language: {language}\nValidate this code:\n\n{code[:12000]}",
            system_prompt=SYNTAX_SYSTEM_PROMPT,
            temperature=0.0,
            max_tokens=768,
            json_mode=True,
        )
        result["ai"] = ai_response
        if ai_response.get("status") != "SUCCESS":
            result["note"] = f"AI validation unavailable (http {ai_response.get('http_code')})"
            return result

        try:
            parsed = json.loads(ai_response["content"])
            ai_issues = parsed.get("issues", [])
            result["issues"] = list(local["issues"]) + list(ai_issues)
            result["valid"] = bool(local["valid"] and parsed.get("valid", True))
            result["status"] = "SUCCESS" if result["valid"] else "INVALID"
        except (json.JSONDecodeError, TypeError, AttributeError):
            result["note"] = "AI response was not valid JSON; kept local verdict"
        return result

    def repair_code(self, code: str, issues: List[Dict[str, Any]]) -> Dict[str, Any]:
        issue_text = json.dumps(issues, ensure_ascii=False)
        response = self.chat(
            prompt=(
                "Fix every issue in the code below and return ONLY the corrected Python code, "
                f"without markdown fences.\n\nIssues: {issue_text}\n\nCode:\n{code[:12000]}"
            ),
            system_prompt="You are an autonomous Python code repair engine.",
            temperature=0.1,
            max_tokens=4096,
        )
        if response.get("status") != "SUCCESS":
            return response
        content = response["content"]
        lines = [line for line in content.splitlines() if not line.strip().startswith("```")]
        response["content"] = "\n".join(lines).strip()
        return response
