

from .agent_contract import ExternalAgent


class OpenCodeAgent(ExternalAgent):


    def name(self):

        return "opencode"


    def execute(self, task):

        return {

            "agent":"opencode",

            "task":task,

            "status":
            "READY"

        }

