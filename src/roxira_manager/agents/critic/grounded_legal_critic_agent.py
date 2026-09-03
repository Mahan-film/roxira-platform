"""
ROXIRA GROUNDED LEGAL CRITIC

Critic with access to legal knowledge graph
"""


from src.roxira_manager.llm_runtime.provider_runtime import ProviderRuntime
from src.roxira_manager.connectors.graphrag.legal_knowledge_connector import LegalKnowledgeConnector



class GroundedLegalCriticAgent:


    def __init__(self):

        self.llm = ProviderRuntime()

        self.memory = LegalKnowledgeConnector()



    def review(self, answer, case):


        sources = self.memory.search(
            case
        )


        context = "\n".join(

            [
                str(x)
                for x in sources
            ]

        )


        prompt = f"""


You are ROXIRA Senior Legal Reviewer.


LEGAL SOURCES:

{context}


AI ANSWER:

{answer}


Evaluate:

1. Wrong legal citations
2. Wrong court jurisdiction
3. Missing procedures
4. Unsupported statements


Return JSON:

errors:
corrections:
confidence:


"""


        return self.llm.generate(

            "deepseek/deepseek-chat",

            prompt

        )

