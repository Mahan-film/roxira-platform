from ...interfaces.agent_interface import AgentInterface


class AiderAdapter(AgentInterface):

    def name(self):
        return "aider"


    def capabilities(self):

        return [
            "small_patch",
            "bug_fix",
            "quick_edit"
        ]


    def execute(self, task):

        return {
            "agent":"aider",
            "task":task,
            "status":"READY"
        }
