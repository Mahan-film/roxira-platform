

class AgentSwarm:


    def spawn(self,task,domain):

        agents=[]


        if domain=="legal":

            agents=[
                "legal_research_agent",
                "reasoning_agent",
                "critic_agent",
                "drafting_agent"
            ]

        else:

            agents=[
                "code_agent",
                "test_agent",
                "review_agent"
            ]


        return {

            "task":task,

            "agents":agents,

            "count":len(agents),

            "status":"SWARM_CREATED"

        }

