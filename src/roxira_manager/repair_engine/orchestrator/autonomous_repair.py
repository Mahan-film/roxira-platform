

from src.roxira_manager.repair_engine.test_intelligence.test_selector import TestSelector
from src.roxira_manager.repair_engine.transaction.transaction_engine import PatchTransaction



class AutonomousRepair:


    def __init__(self):

        self.selector=TestSelector()

        self.transaction=PatchTransaction()



    def execute(self,task,agent="opencode"):


        checkpoint=self.transaction.create_checkpoint()


        plan=self.selector.select_test(task)


        execution=self.transaction.execute_agent(

            agent,

            task

        )


        validation=self.transaction.run_validation(

            plan["scope"]["target"][0]

        )


        decision=self.transaction.commit_decision(

            validation

        )


        return {


            "checkpoint":checkpoint,

            "plan":plan,

            "execution":execution,

            "validation":validation,

            "decision":decision,

            "status":"REPAIR_PIPELINE_COMPLETED"

        }

