

class GatewaySecurity:


    def check_request(self,request):


        blocked=[

            "system_override",

            "ignore_policy"

        ]


        text=str(request)


        for item in blocked:

            if item in text:

                return False



        return True



