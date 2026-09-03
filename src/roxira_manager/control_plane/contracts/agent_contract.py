

class AgentContract:


    def validate(self,agent,result):

        return {

            "agent":agent,

            "received":result is not None,

            "status":"CONTRACT_VALIDATED"

        }

