class ExecutionController:


    def dispatch(self,plan):

        return {

            "plan":plan,

            "status":"EXECUTION_DISPATCHED"

        }
