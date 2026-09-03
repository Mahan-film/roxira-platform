

from .agent_contract import ExternalAgent


class AiderAgent(ExternalAgent):


    def name(self):

        return "aider"


    def execute(self, task):

        return {

            "agent":"aider",

            "task":task,

            "status":
            "READY"

        }

