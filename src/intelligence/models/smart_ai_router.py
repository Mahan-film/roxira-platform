import os
import ssl
import json
import urllib.request
import pathlib
from typing import Dict, Any

class SmartAIRouter:
    """
    ROXIRA 6-TIER ZERO-DOWNTIME AI ROUTER
    سلسله‌مراتب سوییچ خودکار در صورت خطای ۴۲۹ یا تایم‌اوت:
    ۱. Nemotron 3 Ultra (رایگان 1M)
    ۲. Ox Alpha (رایگان 1M)
    ۳. GLM 5.2 (رایگان 256K)
    ۴. Gemma 4 (رایگان 262K)
    ۵. DeepSeek V4 Flash ($0.065/M - تضمینی)
    ۶. Ling 3.0 Flash ($0.021/M - ارزان‌ترین مدل فعال)
    """
    MODELS_PIPELINE = [
        "nvidia/nemotron-3-ultra:free",
        "stealth/ox-alpha:free",
        "z-ai/glm-5.2:free",
        "google/gemma-4-26b-a4b:free",
        "deepseek/deepseek-v4-flash",
        "inclusionai/ling-3.0-flash"
    ]

    def __init__(self):
        self.api_key = self._load_api_key()
        self.ssl_ctx = ssl._create_unverified_context()

    def _load_api_key(self) -> str:
        key = os.getenv("OPENROUTER_API_KEY", "")
        if key:
            return key
        env_file = pathlib.Path(".env")
        if env_file.exists():
            for raw_line in env_file.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if line.startswith("OPENROUTER_API_KEY"):
                    _, separator, val = line.partition("=")
                    if separator:
                        clean_val = val.strip().strip('"').strip("'")
                        if clean_val:
                            return clean_val
        return ""

    def execute_prompt(self, prompt: str, system_prompt: str = "You are an expert multi-lingual enterprise & legal AI advisor.") -> Dict[str, Any]:
        last_error = ""
        for model in self.MODELS_PIPELINE:
            try:
                payload = json.dumps({
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.2
                }).encode("utf-8")

                req = urllib.request.Request(
                    "https://openrouter.ai/api/v1/chat/completions",
                    data=payload,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                        "HTTP-Referer": "https://roxira.net"
                    }
                )

                with urllib.request.urlopen(req, timeout=15, context=self.ssl_ctx) as resp:
                    data = json.loads(resp.read().decode())
                    content = data["choices"][0]["message"]["content"]
                    return {
                        "status": "SUCCESS",
                        "model_used": model,
                        "output": content
                    }
            except Exception as e:
                last_error = str(e)
                continue

        return {"status": "ALL_MODELS_FAILED", "last_error": last_error}

if __name__ == "__main__":
    router = SmartAIRouter()
    res = router.execute_prompt("Say hello in Persian, English, and Arabic in one short line.")
    print("✅ 6-Tier Smart Router Active | Model Used:", res.get("model_used"))
