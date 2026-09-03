

class AgentPolicy:


    def __init__(self):

        self.agents={

            "aider":{

                "role":"patch",

                "risk":"low",

                "scope":"single_file",

                "approval":False

            },


            "openhands":{

                "role":"engineering",

                "risk":"high",

                "scope":"multi_module",

                "approval":True

            },


            "opencode":{

                "role":"analysis",

                "risk":"medium",

                "scope":"exploration",

                "approval":False

            }

        }



    def get(self,agent):

        return self.agents.get(agent)

