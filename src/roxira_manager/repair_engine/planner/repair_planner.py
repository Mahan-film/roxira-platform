

class RepairPlanner:


    def create(self,issues):


        tasks=[]


        for item in issues["issues"]:

            tasks.append({

                "target":item["issue"],

                "action":item["action"],

                "agent":"opencode"

            })


        return {

            "tasks":tasks,

            "status":"REPAIR_PLAN_READY"

        }

