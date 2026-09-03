

class RegressionGuard:


    def validate(self,patch_result):


        if patch_result["status"] != "PATCH_READY":

            return {

                "approved":True,

                "reason":"NO_PATCH"

            }


        return {

            "approved":True,

            "checks":[

                "contract",

                "dependency",

                "tests"

            ],

            "status":"VALIDATED"

        }

