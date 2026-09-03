from ..base import AgentProvider


class OpenCodeProvider(AgentProvider):


    name="opencode"


    def execute(self,request):

        return {

            "provider":self.name,

            "task":request.task,

            "mode":"software_engineering",

            "status":"READY"

        }
