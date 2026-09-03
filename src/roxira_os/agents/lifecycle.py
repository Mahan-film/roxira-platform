

class AgentLifecycle:


    def start(self,agent):

        return {

            "agent":agent.name,

            "state":"ACTIVE"

        }



    def stop(self,agent):

        return {

            "agent":agent.name,

            "state":"STOPPED"

        }

