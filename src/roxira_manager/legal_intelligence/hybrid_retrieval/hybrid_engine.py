

from src.roxira_manager.legal_intelligence.hybrid_retrieval.vector_search import VectorSearch

from src.roxira_manager.legal_intelligence.hybrid_retrieval.graph_search import GraphSearch

from src.roxira_manager.legal_intelligence.hybrid_retrieval.authority_ranker import AuthorityRanker



class HybridRetrievalEngine:


    def retrieve(self,query):


        vector_results = VectorSearch().search(query)

        graph_results = GraphSearch().search(query)


        combined = vector_results + graph_results


        ranked = AuthorityRanker().rank(combined)


        return {

            "query":query,

            "results":ranked,

            "engine":"hybrid_vector_graph_authority"

        }

