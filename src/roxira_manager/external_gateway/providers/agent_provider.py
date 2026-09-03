

class AgentProvider:


    def __init__(self):

        self.providers={

            "aider":{

                "type":"patch",

                "command":"aider"

            },

            "openhands":{

                "type":"autonomous",

                "command":"openhands"

            },

            "opencode":{

                "type":"development",

                "command":"opencode"

            }

        }



    def get(self,name):


        return self.providers.get(name)

