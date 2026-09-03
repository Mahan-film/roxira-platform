

class IntelligentRouter:


    def select(self,task,domain,risk):

        if risk=="high":
            agent="openhands"
            model="deepseek-reasoner"

        elif risk=="medium":
            agent="opencode"
            model="deepseek-chat"

        else:
            agent="aider"
            model="deepseek-chat"


        return {

            "agent":agent,

            "model":model,

            "domain":domain,

            "risk":risk,

            "status":"ROUTED"

        }

