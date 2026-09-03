from ..providers.opencode.provider import OpenCodeExecutor
from ..providers.openhands.provider import OpenHandsExecutor
from ..providers.aider.provider import AiderExecutor


class ExecutionEngine:


    def __init__(self):

        self.providers={

            "opencode":OpenCodeExecutor(),

            "openhands":OpenHandsExecutor(),

            "aider":AiderExecutor()

        }



    def execute(self,request):


        provider=self.providers.get(request.agent)


        if not provider:

            return {

                "status":"AGENT_NOT_FOUND"

            }


        return provider.run(request)
