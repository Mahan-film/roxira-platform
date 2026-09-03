from __future__ import annotations


from .llm_reasoner import LLMReasoner



class ReasoningAgent:


    def __init__(self):

        self.reasoner = LLMReasoner()



    def execute(
        self,
        case_analysis,
        strategy,
        tier="pro"
    ):


        result = self.reasoner.prepare_prompt(

            case_analysis,

            strategy,

            tier

        )


        return {

            "agent":
            "legal_reasoning_agent",

            "llm_request":
            result,

            "status":
            "LLM_READY"

        }
