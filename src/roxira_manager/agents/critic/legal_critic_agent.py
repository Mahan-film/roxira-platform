"""
ROXIRA LEGAL CRITIC AGENT

Reviews legal AI answers
"""

from src.roxira_manager.llm_runtime.provider_runtime import ProviderRuntime



class LegalCriticAgent:


    def __init__(self):

        self.llm = ProviderRuntime()



    def review(self, answer):


        prompt = f"""

You are a senior Iranian lawyer reviewing an AI legal answer.

Check:

1. Are cited laws relevant?
2. Is jurisdiction correct?
3. Are there unsupported claims?
4. Are risks missing?


AI ANSWER:

{answer}


Return:

- errors
- corrections
- confidence score

"""


        return self.llm.generate(

            "deepseek/deepseek-chat",

            prompt

        )

