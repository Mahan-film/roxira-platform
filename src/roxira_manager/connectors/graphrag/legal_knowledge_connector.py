"""
ROXIRA LEGAL KNOWLEDGE CONNECTOR

Bridge:
ROXIRA Manager
        |
        v
Smart Judge GraphRAG
"""


from output_apps.smart_judge.src.graphrag.retrievers.hybrid_retriever import HybridRetriever



class LegalKnowledgeConnector:


    def __init__(self):

        self.retriever = HybridRetriever()



    def search(self, query, limit=5):


        results = self.retriever.retrieve(
            query,
            limit=limit
        )


        return results

