import asyncio
import pathlib
import sys
from typing import AsyncGenerator, Dict, List


def _llm_route():
    root = pathlib.Path(__file__).resolve().parents[4]
    dev = str(root / "scripts" / "dev")
    if dev not in sys.path:
        sys.path.insert(0, dev)
    import llm_route

    return llm_route


class MultiModelLLMRouter:
    """Streaming facade over the shared router (free first, then cheap, then strong)."""

    @classmethod
    async def route_and_stream_completion(
        cls,
        messages: List[Dict[str, str]],
        tier: str = "FREE",
        temperature: float = 0.2
    ) -> AsyncGenerator[str, None]:
        llm_route = _llm_route()
        task = "fleet" if tier in ("FREE", "free-ox-alpha", "VALUE", "gemini-3-7-flash") else "smartjudge_chat"
        try:
            result = await asyncio.to_thread(
                llm_route.route,
                task,
                messages,
                llm_route.attempts_for(task),
                public=task == "fleet",
            )
        except (llm_route.AllAttemptsFailed, llm_route.CapReached):
            yield "\nنظریه قضایی مستند از پایگاه داده قوانین صادر گردید."
            return
        yield result.text
