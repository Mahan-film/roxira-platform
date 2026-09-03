class AgentRouter:


    def select(self,task,risk):


        if risk=="high":

            return "openhands"


        if "patch" in task.lower():

            return "aider"


        return "opencode"
