from ..provider_interface import AgentProvider


class OpenHandsProvider(AgentProvider):

    name="openhands"


    def execute(self,task):

        return {

            "provider":self.name,
            "task":task,
            "status":"READY"

        }
