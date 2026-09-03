

class AgentService:


    def __init__(self):

        self.agents={}



    def register_agent(self,name,agent):

        self.agents[name]=agent



    def execute(self,name,task):

        agent=self.agents.get(name)

        if not agent:

            return {
                "status":"AGENT_NOT_FOUND"
            }


        return agent.execute(task)



    def list_agents(self):

        return list(self.agents.keys())

