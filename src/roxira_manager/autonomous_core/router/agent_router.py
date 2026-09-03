

class AgentRouter:


    def route(self,domain,risk):

        if domain=="legal":

            agent="openhands"

        elif risk=="low":

            agent="aider"

        else:

            agent="opencode"


        return {

            "agent":agent,

            "status":"AGENT_SELECTED"

        }

