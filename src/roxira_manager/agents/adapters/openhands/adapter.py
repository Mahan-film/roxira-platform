from ...interfaces.agent_interface import AgentInterface


class OpenHandsAdapter(AgentInterface):

    def name(self):
        return "openhands"


    def capabilities(self):

        return [
            "autonomous_engineering",
            "long_running_tasks",
            "planning"
        ]


    def execute(self, task):

        return {
            "agent":"openhands",
            "task":task,
            "status":"READY"
        }
