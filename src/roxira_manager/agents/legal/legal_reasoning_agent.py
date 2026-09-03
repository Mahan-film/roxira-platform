"""
ROXIRA LEGAL REASONING AGENT

Pipeline:
Case
 |
Research
 |
LLM Reasoning
 |
Verification
"""


from src.roxira_manager.llm_runtime.provider_runtime import ProviderRuntime
from src.roxira_manager.verification.legal_verifier import LegalVerifier



class LegalReasoningAgent:


    def __init__(self):

        self.llm = ProviderRuntime()
        self.verifier = LegalVerifier()



    def analyze(self, case):


        prompt = f"""

You are ROXIRA Legal AI.

Only use verified Iranian legal sources.

CASE:

{case}


Provide:

1. Legal classification
2. Jurisdiction
3. Applicable laws
4. Risks
5. Strategy


"""


        response = self.llm.generate(

            "deepseek/deepseek-chat",

            prompt

        )


        verification = self.verifier.verify(
            response
        )


        return {

            "analysis": response,

            "verification": verification

        }


