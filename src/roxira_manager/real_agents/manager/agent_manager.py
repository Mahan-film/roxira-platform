
from src.roxira_manager.real_agents.adapters.cli_adapter import CLIAdapter


class AgentManager:


    def __init__(self):

        self.adapter=CLIAdapter()



    def execute(self,agent,task):


        if agent=="opencode":

            return self.adapter.run(
                "opencode",
                [
                    "--task",
                    task
                ]
            )


        if agent=="aider":

            return self.adapter.run(
                "aider",
                [
                    "--message",
                    task
                ]
            )


        if agent=="openhands":

            return self.adapter.run(
                "openhands",
                [
                    task
                ]
            )


        return {
            "status":"UNKNOWN_AGENT"
        }

