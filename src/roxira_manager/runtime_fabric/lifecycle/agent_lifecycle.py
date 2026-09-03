class AgentLifecycle:


    def start(self,agent):

        return {

            "agent":agent,

            "state":"STARTED"

        }



    def stop(self,agent):

        return {

            "agent":agent,

            "state":"STOPPED"

        }
