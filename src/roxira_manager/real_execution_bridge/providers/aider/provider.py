from ..base_provider import BaseProvider


class AiderExecutor(BaseProvider):


    name="aider"


    def run(self,request):

        return {

            "agent":self.name,

            "task":request.task,

            "mode":"patch",

            "status":"READY_FOR_EXECUTION"

        }
