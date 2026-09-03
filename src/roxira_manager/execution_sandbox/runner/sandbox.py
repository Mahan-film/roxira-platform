

class Sandbox:


    def prepare(self,task):


        return {

            "task":task,

            "environment":"isolated",

            "safety":"enabled",

            "status":"SANDBOX_READY"

        }

