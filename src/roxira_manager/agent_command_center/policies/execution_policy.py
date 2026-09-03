class ExecutionPolicy:


    def allow(self,risk):


        return {

            "risk":risk,

            "sandbox_required":True,

            "approval_required":risk=="high"

        }
