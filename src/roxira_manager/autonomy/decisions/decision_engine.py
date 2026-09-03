class DecisionEngine:


    def decide(self,validation):

        if validation.get("status")=="PASS":

            return "COMMIT"


        return "ROLLBACK"
