

class PatchPlanner:


    def create(self, bug):


        if bug.get("bug_found"):


            return {

                "action":
                "CREATE_PATCH",

                "priority":
                "HIGH"

            }


        return {

            "action":
            "NONE"

        }

