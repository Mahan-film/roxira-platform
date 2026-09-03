

class RepositoryContext:


    def build(self):

        return {

            "indexed":True,

            "memory":"qdrant",

            "graph":"knowledge_graph",

            "status":"CONTEXT_READY"

        }

