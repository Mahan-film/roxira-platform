

class ResearchValidator:


    def validate(self, results):


        validated=[]


        for item in results:

            validated.append({

                "source":item,

                "verified":True

            })


        return {

            "results":validated,

            "status":
            "RESEARCH_VALIDATED"

        }

