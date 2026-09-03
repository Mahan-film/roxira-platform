class ExecutionBridge:


    def execute(self,agent,task):

        return {

            "agent":agent,

            "task":task,

            "status":"EXECUTION_READY"

        }
