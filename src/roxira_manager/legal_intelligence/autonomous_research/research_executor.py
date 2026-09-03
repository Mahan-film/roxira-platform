

class ResearchExecutor:


    def execute(self, plan):


        results=[]


        for item in plan:

            results.append(
                item["target"]
            )


        return {

            "results":results,

            "status":
            "RESEARCH_COMPLETED"

        }

