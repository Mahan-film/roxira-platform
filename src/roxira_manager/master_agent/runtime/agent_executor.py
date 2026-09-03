

from src.roxira_manager.master_agent.core.master_core import MasterCore
from src.roxira_manager.dev_agent.autonomous_controller.controller import AutonomousEngineeringController


class AgentExecutor:


    def __init__(self):

        self.core = MasterCore()
        self.engine = AutonomousEngineeringController()



    def run(self,task,domain):


        preparation = self.core.prepare(
            task,
            domain
        )


        result = self.engine.process(
            task,
            preparation["plan"]["task_type"]
        )


        return {

            "preparation":preparation,

            "execution":result,

            "status":"AGENT_EXECUTION_READY"

        }

