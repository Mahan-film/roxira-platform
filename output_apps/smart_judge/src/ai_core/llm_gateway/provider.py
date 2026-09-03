from __future__ import annotations

import os
from openai import OpenAI


class LLMProvider:

    def __init__(self):
        self.provider = os.getenv(
            "LLM_PROVIDER",
            "openrouter"
        )

        if self.provider == "openrouter":
            self.client = OpenAI(
                api_key=os.getenv("OPENROUTER_API_KEY"),
                base_url=os.getenv(
                    "OPENROUTER_BASE_URL",
                    "https://openrouter.ai/api/v1"
                )
            )

        elif self.provider == "deepseek":
            self.client = OpenAI(
                api_key=os.getenv("DEEPSEEK_API_KEY"),
                base_url="https://api.deepseek.com"
            )

        else:
            raise ValueError(
                f"Unsupported LLM provider: {self.provider}"
            )


    def chat(
        self,
        messages: list,
        model: str,
        temperature: float = 0.2
    ):

        response = self.client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature
        )

        return response.choices[0].message.content