

class HealthChecker:


    def check(self,module):


        required=[
            "name",
            "version"
        ]


        missing=[]


        for item in required:

            if item not in module:

                missing.append(item)



        return {

            "healthy":
            len(missing)==0,

            "missing":
            missing

        }

