

class AgentExecutor:


    def run(self,provider,task):


        return {

            "provider":provider,

            "task":task,

            "execution_mode":"EXTERNAL_AGENT",

            "status":"READY_FOR_EXECUTION"

        }

