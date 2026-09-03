from ..provider_interface import AgentProvider


class OpenCodeProvider(AgentProvider):

    name="opencode"


    def execute(self,task):

        return {

            "provider":self.name,
            "task":task,
            "status":"READY"

        }
