

class ToolRuntime:


    def select(self,task):


        tools=[]


        if "legal" in task:

            tools.extend([

                "legal_search",

                "vector_memory",

                "knowledge_graph"

            ])


        tools.extend([

            "code_scan",

            "test_runner",

            "git_guard"

        ])


        return {

            "tools":tools,

            "status":"TOOLS_READY"

        }

