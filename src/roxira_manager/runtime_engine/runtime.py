

from .model_policy import ModelPolicy

from .cost_guard import CostGuard

from .retry_manager import RetryManager



class AgentRuntime:


    def __init__(self):

        self.model_policy=ModelPolicy()

        self.cost=CostGuard()

        self.retry=RetryManager()



    def execute(
        self,
        task,
        tier
    ):


        model=self.model_policy.select(
            tier
        )


        return {

            "task":task,

            "tier":tier,

            "model":model,

            "status":
            "READY"

        }



