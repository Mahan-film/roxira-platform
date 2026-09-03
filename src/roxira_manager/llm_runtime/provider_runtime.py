from __future__ import annotations

import os
from dotenv import load_dotenv
from openai import OpenAI


PROJECT_ROOT = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "../../.."
    )
)

load_dotenv(
    os.path.join(PROJECT_ROOT, ".env")
)



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


        self.client = OpenAI(

            api_key=api_key,

            base_url=os.getenv(
                "OPENROUTER_BASE_URL",
                "https://openrouter.ai/api/v1"
            )

        )



    def generate(
        self,
        model: str,
        prompt: str
    ):


        response = self.client.chat.completions.create(

            model=model,

            messages=[
                {
                    "role":"system",
                    "content":
                    "You are ROXIRA Legal AI."
                },
                {
                    "role":"user",
                    "content":prompt
                }
            ],

            temperature=0.2

        )


        return {

            "model": model,

            "output":
            response.choices[0].message.content

        }
