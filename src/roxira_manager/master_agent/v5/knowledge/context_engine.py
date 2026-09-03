

class ContextEngine:


    def build(self,task):

        return {

            "task":task,

            "sources":[

                "qdrant",

                "knowledge_graph",

                "repository_index"

            ],

            "status":"CONTEXT_LOADED"

        }

