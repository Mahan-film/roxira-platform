import pathlib
import sys
from typing import Tuple


def _llm_route():
    root = pathlib.Path(__file__).resolve().parents[3]
    dev = str(root / "scripts" / "dev")
    if dev not in sys.path:
        sys.path.insert(0, dev)
    import llm_route

    return llm_route


def call_live_model(prompt: str, system_prompt: str = "", task_type: str = "gemini_frontier") -> Tuple[str, str]:
    """One routed call (free first, then cheap, then strong). Returns (text, served model)."""
    llm_route = _llm_route()
    messages = [
        {"role": "system", "content": system_prompt or "You are Roxira OS Chief Autonomous Engine."},
        {"role": "user", "content": prompt},
    ]
    try:
        result = llm_route.route(
            "fleet",
            messages,
            llm_route.attempts_for("fleet", timeout=30.0),
            max_tokens=3000,
            public=True,
        )
    except (llm_route.AllAttemptsFailed, llm_route.CapReached):
        return "Fallback Engine Active", "Local-Rule-Engine"
    if result.text and len(result.text.strip()) > 5:
        return result.text, result.served
    return "Fallback Engine Active", "Local-Rule-Engine"


if __name__ == "__main__":
    print("Testing routed frontier AI models...")
    res, m = call_live_model("Verify Roxira autonomous stack integrity and report status in one sentence.", task_type="gemini_frontier")
    print(f"Response from [{m}]:\n{res}")
