

class ResultAnalyzer:


    def analyze(self,result):


        if result["exit_code"]==0:

            score=100

        else:

            score=0


        return {

            "score":score,

            "learning":"UPDATED",

            "status":"RESULT_ANALYZED"

        }

