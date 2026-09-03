from __future__ import annotations


from src.roxira_manager.llm.model_router import ModelRouter



class LLMReasoner:


    def __init__(self):

        self.router = ModelRouter()



    def prepare_prompt(
        self,
        case_analysis,
        strategy,
        tier="pro"
    ):


        model = self.router.select_model(
            tier
        )


        prompt = f"""

You are ROXIRA Legal AI.

Analyze this Iranian legal case.

CASE:
{case_analysis}


LEGAL STRATEGY:
{strategy}


Provide:

1. Legal reasoning
2. Applicable laws
3. Risks
4. Recommended action

"""


        return {

            "model":
            model,

            "prompt":
            prompt,

            "tier":
            tier

        }
