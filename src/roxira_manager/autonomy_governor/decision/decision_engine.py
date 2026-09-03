class DecisionEngine:


    def decide(self,risk):

        if risk["risk"]=="HIGH":

            return {

                "decision":"WAIT_APPROVAL"

            }


        return {

            "decision":"EXECUTE"

        }
