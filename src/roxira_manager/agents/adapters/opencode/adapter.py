from ...interfaces.agent_interface import AgentInterface


class OpenCodeAdapter(AgentInterface):

    def name(self):
        return "opencode"


    def capabilities(self):

        return [
            "code_edit",
            "refactor",
            "repository_analysis",
            "testing"
        ]


    def execute(self, task):

        return {
            "agent":"opencode",
            "task":task,
            "status":"READY"
        }
