from ..base import AgentProvider


class AiderProvider(AgentProvider):


    name="aider"


    def execute(self,request):

        return {

            "provider":self.name,

            "task":request.task,

            "mode":"precision_patch",

            "status":"READY"

        }
