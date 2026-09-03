

from .task_planner import TaskPlanner
from .llm_router import LLMRouter
from .memory_loop import MemoryLoop


class MasterCore:


    def __init__(self):

        self.planner=TaskPlanner()
        self.llm=LLMRouter()
        self.memory=MemoryLoop()



    def prepare(self,task,domain):

        plan=self.planner.analyze(
            task,
            domain
        )

        model=self.llm.select(
            task
        )

        memory=self.memory.store(
            {
            "task":task,
            "plan":plan
            }
        )


        return {

            "plan":plan,

            "model":model,

            "memory":memory,

            "status":"MASTER_CORE_READY"

        }

