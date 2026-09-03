"""
ROXIRA FULL LEGAL CASE PIPELINE

Complete workflow:
Case
-> Decision
-> Research
-> Reasoning
-> Critic
-> Draft
"""


from src.roxira_manager.decision_engine.jurisdiction_engine import JurisdictionEngine
from src.roxira_manager.agents.legal.legal_grounded_reasoning_agent import LegalGroundedReasoningAgent
from src.roxira_manager.agents.critic.grounded_legal_critic_agent import GroundedLegalCriticAgent



class FullLegalCasePipeline:


    def __init__(self):

        self.decision = JurisdictionEngine()

        self.reasoning = LegalGroundedReasoningAgent()

        self.critic = GroundedLegalCriticAgent()



    def run(self, case):


        decision_result = self.decision.analyze(
            case
        )


        reasoning_result = self.reasoning.analyze(
            case
        )


        critic_result = self.critic.review(

            str(reasoning_result),

            case

        )


        return {

            "case":case,

            "decision":
                decision_result,

            "reasoning":
                reasoning_result,

            "critic":
                critic_result,

            "status":
                "PIPELINE_COMPLETED"

        }

