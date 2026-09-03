

class ApprovalEngine:


    def check(self,risk):

        if risk=="high":

            return {

                "approved":False,

                "reason":"HUMAN_APPROVAL_REQUIRED"

            }


        return {

            "approved":True

        }

