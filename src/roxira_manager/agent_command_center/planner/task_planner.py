class TaskPlanner:


    def create_plan(self,mission):


        return {

            "mission":mission,

            "steps":[

                "analysis",
                "implementation",
                "validation",
                "memory_update"

            ],

            "status":"PLANNED"

        }
