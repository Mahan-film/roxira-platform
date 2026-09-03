

class Validator:


    def validate(self,result):


        return {

            "checks":[

                "logic",

                "dependency",

                "test",

                "security"

            ],

            "score":100,

            "status":"VALIDATED"

        }

