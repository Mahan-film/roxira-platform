

class FeedbackLoop:


    def __init__(self):

        self.records=[]


    def evaluate(self,result):


        status=result.get("status")


        score=100 if "READY" in status else 50


        record={

            "status":status,

            "score":score

        }


        self.records.append(record)


        return {

            "score":score,

            "learned":True,

            "count":len(self.records),

            "status":"FEEDBACK_STORED"

        }



    def history(self):

        return self.records

