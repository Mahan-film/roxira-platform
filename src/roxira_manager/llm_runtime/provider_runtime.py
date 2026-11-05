from __future__ import annotations

import os
import pathlib
import sys

from dotenv import load_dotenv


PROJECT_ROOT = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "../../.."
    )
)

load_dotenv(
    os.path.join(PROJECT_ROOT, ".env")
)


def _llm_route():
    root = pathlib.Path(__file__).resolve().parents[3]
    dev = str(root / "scripts" / "dev")
    if dev not in sys.path:
        sys.path.insert(0, dev)
    import llm_route

    return llm_route


class ProviderRuntime:


    def __init__(self):

        api_key = (
            os.getenv("OPENROUTER_API_KEY")
            or
            os.getenv("DEEPSEEK_API_KEY")
            or
            os.getenv("OPENAI_API_KEY")
        )


        if not api_key:
            raise RuntimeError(
                "LLM API KEY NOT FOUND IN ENV"
            )


    def generate(
        self,
        model: str,
        prompt: str
    ):

        llm_route = _llm_route()
        messages = [
            {
                "role": "system",
                "content": "You are ROXIRA Legal AI."
            },
            {
                "role": "user",
                "content": prompt
            }
        ]

        result = llm_route.route(
            "smartjudge_chat",
            messages,
            llm_route.attempts_for("smartjudge_chat"),
            public=False,
        )

        return {

            "model": result.served,

            "output": result.text

        }
