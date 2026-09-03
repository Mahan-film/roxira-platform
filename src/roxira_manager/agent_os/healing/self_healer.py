

class SelfHealingEngine:


    def analyze(self,result):


        if result.get("final_status")=="ORCHESTRATION_COMPLETED":

            return {

                "action":"NONE",

                "status":"HEALTHY"

            }



        return {

            "action":"RETRY",

            "status":"RECOVERY_REQUIRED"

        }

