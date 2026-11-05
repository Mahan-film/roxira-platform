import pathlib
import sys
from typing import Dict, Any


def _llm_route():
    root = pathlib.Path(__file__).resolve().parents[3]
    dev = str(root / "scripts" / "dev")
    if dev not in sys.path:
        sys.path.insert(0, dev)
    import llm_route

    return llm_route


class SmartAIRouter:
    """Zero-downtime router: free first, then cheap, then strong (scripts/dev/llm_route.py)."""

    def execute_prompt(self, prompt: str, system_prompt: str = "You are an expert multi-lingual enterprise & legal AI advisor.") -> Dict[str, Any]:
        llm_route = _llm_route()
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ]
        try:
            result = llm_route.route(
                "fleet",
                messages,
                llm_route.attempts_for("fleet", timeout=15.0),
                public=True,
            )
        except (llm_route.AllAttemptsFailed, llm_route.CapReached) as exc:
            return {"status": "ALL_MODELS_FAILED", "last_error": str(exc)}
        return {
            "status": "SUCCESS",
            "model_used": result.served,
            "output": result.text,
        }


if __name__ == "__main__":
    router = SmartAIRouter()
    res = router.execute_prompt("Say hello in Persian, English, and Arabic in one short line.")
    print("✅ Smart Router Active | Model Used:", res.get("model_used"))
