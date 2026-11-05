from __future__ import annotations

import json
import pathlib
import sys
from typing import Literal, Dict, Any

TaskType = Literal["FREE_EXTRACTION", "FREE_REASONING", "BUDGET_FAST", "DEEP_LEGAL"]

#: Task chains live in config/models.yaml; this maps the legacy tier names onto them.
TASK_FOR_TIER: Dict[TaskType, str] = {
    "FREE_EXTRACTION": "fleet",
    "FREE_REASONING": "fleet",
    "BUDGET_FAST": "fleet",
    "DEEP_LEGAL": "smartjudge_chat",
}


def _llm_route():
    root = pathlib.Path(__file__).resolve().parents[4]
    dev = str(root / "scripts" / "dev")
    if dev not in sys.path:
        sys.path.insert(0, dev)
    import llm_route

    return llm_route


class CostOptimizedAIRouter:
    """Multi-tier AI router: free first, then cheap, then strong (scripts/dev/llm_route.py)."""

    def execute(
        self,
        prompt: str,
        system_prompt: str,
        task_tier: TaskType = "FREE_EXTRACTION",
        json_mode: bool = True
    ) -> Dict[str, Any]:
        llm_route = _llm_route()
        task = TASK_FOR_TIER.get(task_tier, "fleet")
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ]
        try:
            result = llm_route.route(
                task,
                messages,
                llm_route.attempts_for(task),
                max_tokens=4096,
                public=task == "fleet",
            )
        except (llm_route.AllAttemptsFailed, llm_route.CapReached) as exc:
            return {"status": "ALL_MODELS_FAILED", "last_error": str(exc)}

        try:
            parsed_json = json.loads(result.text) if json_mode else {"text": result.text}
        except ValueError as exc:
            return {"status": "ALL_MODELS_FAILED", "last_error": f"invalid JSON: {exc}"}

        return {
            "status": "SUCCESS",
            "model_used": result.served,
            "is_free_tier": ":free" in result.served,
            "data": parsed_json,
        }


if __name__ == "__main__":
    router = CostOptimizedAIRouter()
    print("=== TESTING FREE-TIER AI ROUTING ===")
    out = router.execute(
        prompt="سه اصل اساسی حسابداری دوبل را در قالب یک شیء JSON با کلید principles فهرست کن.",
        system_prompt="پاسخ را فقط به صورت JSON معتبر ارائه بده.",
        task_tier="FREE_EXTRACTION",
        json_mode=True
    )
    print(json.dumps(out, indent=2, ensure_ascii=False))
