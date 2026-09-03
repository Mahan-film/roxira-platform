

class RetryManager:


    def decide(self,result):


        if result.get("status")=="FAILED":

            return {

                "retry":True,

                "reason":"execution_failed"

            }


        return {

            "retry":False

        }



