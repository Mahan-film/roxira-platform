

class ModelRuntime:


    def call(self,model,task):


        return {

            "model":model,

            "task":task,

            "response":"MODEL_RESPONSE_READY",

            "status":"LLM_CONNECTED"

        }

