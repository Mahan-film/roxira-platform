
class TaskPlanner:


    def analyze(self,task,domain):

        if domain=="legal":
            return {
                "agent":"openhands",
                "task_type":"ARCHITECTURE",
                "risk":"high"
            }


        if "fix" in task.lower():

            return {
                "agent":"aider",
                "task_type":"BUG_FIX",
                "risk":"low"
            }


        return {
            "agent":"opencode",
            "task_type":"ANALYSIS",
            "risk":"medium"
        }

