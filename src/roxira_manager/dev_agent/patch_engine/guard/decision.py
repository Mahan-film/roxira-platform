

class PatchDecision:


    def decide(self,state):


        if state["exists"]:

            return {

                "decision":
                "EXECUTE_PATCH"

            }


        return {

            "decision":
            "SKIP_PATCH",

            "reason":
            state["action"]

        }

