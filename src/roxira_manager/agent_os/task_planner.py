

class TaskPlanner:


    def plan(self,task):


        return {


            "task":task,


            "steps":[

                "analyze",

                "select_agent",

                "execute",

                "validate",

                "store_memory"

            ]

        }


