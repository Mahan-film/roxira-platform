class AutonomousMissionPlanner:


    def plan(self,analysis):

        return {

            "analysis":analysis,

            "steps":[
                "select_agent",
                "execute",
                "verify",
                "learn"
            ],

            "status":"PLAN_READY"

        }
