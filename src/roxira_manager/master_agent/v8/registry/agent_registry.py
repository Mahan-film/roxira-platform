

class AgentRegistry:


    def __init__(self):

        self.agents={

            "aider":{

                "role":"patch",

                "risk":"low"

            },

            "opencode":{

                "role":"development",

                "risk":"medium"

            },

            "openhands":{

                "role":"architecture",

                "risk":"high"

            }

        }


    def get(self):

        return self.agents

