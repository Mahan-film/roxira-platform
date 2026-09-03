

from src.roxira_manager.master_agent.orchestration.orchestrator import MasterOrchestrator
from src.roxira_manager.master_agent.memory.long_term_memory import LongTermMemory



class AutonomousManager:


    def __init__(self):

        self.orchestrator=MasterOrchestrator()
        self.memory=LongTermMemory()



    def execute(self,task,domain):


        result=self.orchestrator.run(
            task,
            domain
        )


        self.memory.save(
            {
                "task":task,
                "domain":domain,
                "status":result["status"]
            }
        )


        return {

            "result":result,

            "memory":"UPDATED",

            "status":"AUTONOMOUS_MANAGER_READY"

        }

