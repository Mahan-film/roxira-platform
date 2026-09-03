

class ResearchPlanner:


    def create_plan(self, gaps):


        steps=[]


        for gap in gaps:


            steps.append({

                "target":gap,

                "action":
                "SEARCH_AND_VALIDATE"

            })


        return {

            "plan":steps,

            "status":
            "RESEARCH_PLAN_READY"

        }

