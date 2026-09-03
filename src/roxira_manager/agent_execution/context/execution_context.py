class ExecutionContext:


    def build(
        self,
        task,
        memory
    ):

        return {

            "task":task,

            "memory":memory,

            "status":"CONTEXT_READY"

        }
