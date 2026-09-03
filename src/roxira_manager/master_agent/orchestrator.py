
from src.roxira_manager.dev_agent.autonomous_loop.loop import AutonomousLoop


class RoxiraMasterAgent:


    def __init__(self):

        self.engine = AutonomousLoop()


    def execute_task(self, task, domain):

        task_type = "BUG_FIX"

        if domain == "architecture":
            task_type = "ARCHITECTURE"

        if domain == "legal":
            task_type = "LEGAL"


        result = self.engine.execute(
            task,
            task_type
        )


        return {
            "task":task,
            "domain":domain,
            "result":result,
            "status":"MASTER_AGENT_EXECUTED"
        }

