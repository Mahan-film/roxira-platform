from ..provider_interface import AgentProvider


class AiderProvider(AgentProvider):

    name="aider"


    def execute(self,task):

        return {

            "provider":self.name,
            "task":task,
            "status":"READY"

        }
