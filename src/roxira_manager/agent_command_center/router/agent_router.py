class AgentRouter:


    def select(self,task,risk="low"):


        if risk=="high":

            return "openhands"


        if "refactor" in task.lower():

            return "aider"


        return "opencode"
