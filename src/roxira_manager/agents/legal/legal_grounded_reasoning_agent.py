"""
ROXIRA GROUNDED LEGAL REASONING AGENT

LLM cannot answer without legal context.
"""


from src.roxira_manager.llm_runtime.provider_runtime import ProviderRuntime
from src.roxira_manager.connectors.graphrag.legal_knowledge_connector import LegalKnowledgeConnector
from src.roxira_manager.verification.legal_verifier import LegalVerifier



class LegalGroundedReasoningAgent:



    def __init__(self):

        self.llm = ProviderRuntime()

        self.memory = LegalKnowledgeConnector()

        self.validator = LegalVerifier()



    def analyze(self, case):


        knowledge = self.memory.search(
            case
        )


        context = "\n\n".join(

            [
                str(item)
                for item in knowledge
            ]

        )


        prompt = f"""

You are ROXIRA Legal AI.

IMPORTANT:
Use ONLY the provided Iranian legal sources.

LEGAL KNOWLEDGE:

{context}


CASE:

{case}


Provide:

1. Jurisdiction
2. Applicable laws
3. Legal strategy
4. Risks

Every legal citation must exist in provided knowledge.


"""


        response = self.llm.generate(

            "deepseek/deepseek-chat",

            prompt

        )


        verification = self.validator.verify(

            response,

            knowledge

        )


        return {

            "knowledge_used": knowledge,

            "analysis": response,

            "verification": verification

        }


