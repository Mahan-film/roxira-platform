class AgentRouter:


    def select(self,task):

        if "code" in task.lower():

            return "opencode"

        if "research" in task.lower():

            return "openhands"

        return "aider"
