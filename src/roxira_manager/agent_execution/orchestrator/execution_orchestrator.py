class ExecutionOrchestrator:


    def execute(
        self,
        task,
        agent
    ):

        return {

            "task":task,

            "agent":agent,

            "status":"EXECUTION_STARTED"

        }
