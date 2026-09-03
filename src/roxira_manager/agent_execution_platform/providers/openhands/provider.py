from ..base import AgentProvider


class OpenHandsProvider(AgentProvider):


    name="openhands"


    def execute(self,request):

        return {

            "provider":self.name,

            "task":request.task,

            "mode":"autonomous_agent",

            "status":"READY"

        }
