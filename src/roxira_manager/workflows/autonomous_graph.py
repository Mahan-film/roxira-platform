

from src.roxira_manager.autonomous.router import AutonomousRouter
from src.roxira_manager.autonomous.planner import AutonomousPlanner
from src.roxira_manager.autonomous.executor import AutonomousExecutor
from src.roxira_manager.autonomous.validator import AutonomousValidator
from src.roxira_manager.autonomous.memory import AutonomousMemory



class AutonomousGraph:


    def run(self,task):


        router=AutonomousRouter()

        planner=AutonomousPlanner()

        executor=AutonomousExecutor()

        validator=AutonomousValidator()

        memory=AutonomousMemory()


        agent=router.select_agent(task)


        plan=planner.create_plan(
            task,
            agent
        )


        result=executor.execute(
            agent,
            task
        )


        validation=validator.validate(
            result
        )


        memory_result=memory.store(
            result
        )


        return {

            "task":task,

            "agent":agent,

            "plan":plan,

            "result":result,

            "validation":validation,

            "memory":memory_result,

            "status":"AUTONOMOUS_READY"

        }

