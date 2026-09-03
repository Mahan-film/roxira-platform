
from src.roxira_manager.master_agent.autonomy.autonomous_manager import AutonomousManager


class SuperAgent:


    def __init__(self):

        self.engine = AutonomousManager()



    def run(self, task, domain):


        result = self.engine.execute(
            task,
            domain
        )


        return {

            "task":task,

            "domain":domain,

            "execution":result,

            "status":"SUPER_AGENT_ACTIVE"

        }


