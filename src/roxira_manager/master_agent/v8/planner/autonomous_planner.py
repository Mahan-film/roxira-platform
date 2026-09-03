

class AutonomousPlanner:


    def build(self,analysis):


        return {

            "task":analysis["task"],

            "risk":analysis["risk"],

            "steps":[

                "SELECT_AGENT",

                "EXECUTE",

                "TEST",

                "VERIFY"

            ],

            "status":"PLAN_READY"

        }

