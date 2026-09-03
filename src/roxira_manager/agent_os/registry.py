
class AgentRegistry:


    def __init__(self):

        self.agents={}



    def register(
        self,
        name,
        capabilities,
        tier
    ):

        self.agents[name]={

            "capabilities":capabilities,

            "tier":tier

        }


        return self.agents[name]



    def get(self,name):

        return self.agents.get(name)



