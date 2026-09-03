

class MissionPlanner:


    def plan(self,mission):

        return {

            "mission":mission["mission"],

            "pipeline":[

                "SCAN",

                "ANALYZE",

                "PATCH",

                "TEST",

                "VERIFY",

                "MEMORY"

            ],

            "status":"PIPELINE_READY"

        }

