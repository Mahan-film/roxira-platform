
from src.roxira_manager.dev_agent.autonomous_controller.controller import AutonomousEngineeringController
from src.roxira_manager.dev_agent.git_safety.git_guard import GitGuard


class AutonomousLoop:


    def __init__(self):

        self.engine = AutonomousEngineeringController()
        self.git = GitGuard()


    def execute(self, task, task_type):


        checkpoint = self.git.checkpoint(
            "before autonomous execution"
        )


        result = self.engine.process(
            task,
            task_type
        )


        return {

            "checkpoint":checkpoint,

            "execution":result,

            "status":"AUTONOMOUS_LOOP_READY"

        }

