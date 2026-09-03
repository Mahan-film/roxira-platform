

class TaskPlanner:


    def create(self,task,domain):

        return {

            "task":task,

            "domain":domain,

            "steps":[

                "ANALYZE",

                "SELECT_AGENT",

                "SELECT_MODEL",

                "EXECUTE",

                "VALIDATE",

                "LEARN"

            ],

            "status":"PLAN_READY"

        }

