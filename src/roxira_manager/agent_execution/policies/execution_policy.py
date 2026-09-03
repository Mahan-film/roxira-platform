class ExecutionPolicy:


    def check(
        self,
        task,
        risk
    ):

        return {

            "task":task,

            "risk":risk,

            "approved":True

        }
