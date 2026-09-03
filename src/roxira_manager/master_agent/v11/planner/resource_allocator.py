

class ResourceAllocator:


    def allocate(self,decision):


        return {

            "agents":[

                "research_agent",

                "reasoning_agent",

                "developer_agent",

                "critic_agent"

            ],

            "tools":[

                "qdrant",

                "knowledge_graph",

                "git",

                "test_runner"

            ],

            "status":"RESOURCES_ALLOCATED"

        }

