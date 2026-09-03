from ..base_provider import BaseProvider


class OpenCodeExecutor(BaseProvider):


    name="opencode"


    def run(self,request):

        return {

            "agent":self.name,

            "task":request.task,

            "mode":"coding",

            "status":"READY_FOR_EXECUTION"

        }
