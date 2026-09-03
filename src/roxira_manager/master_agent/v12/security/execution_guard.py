

class ExecutionGuard:


    def check(self,task,risk):


        if risk=="high":

            return {

                "allowed":False,

                "approval":"REQUIRED"

            }


        return {

            "allowed":True,

            "approval":"NOT_REQUIRED"

        }


