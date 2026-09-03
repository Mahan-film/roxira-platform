from ..base_provider import BaseProvider


class OpenHandsExecutor(BaseProvider):


    name="openhands"


    def run(self,request):

        return {

            "agent":self.name,

            "task":request.task,

            "mode":"autonomous",

            "status":"READY_FOR_EXECUTION"

        }
