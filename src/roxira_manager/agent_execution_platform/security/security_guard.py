class SecurityGuard:


    def check(self,request):

        return {

            "allowed":True,

            "risk":request.risk

        }
