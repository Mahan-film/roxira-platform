

class AutonomousValidator:


    def validate(self,result):


        if result.get("status")=="COMPLETED":

            return {

                "valid":True,

                "confidence":0.95

            }


        return {

            "valid":False,

            "confidence":0

        }

