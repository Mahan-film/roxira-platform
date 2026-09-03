

from .agent_contract import ExternalAgent


class OpenHandsAgent(ExternalAgent):


    def name(self):

        return "openhands"


    def execute(self, task):

        return {

            "agent":"openhands",

            "task":task,

            "status":
            "READY"

        }

