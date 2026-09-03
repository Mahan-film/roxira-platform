

class PatchWriter:


    def create_patch(self, contract):


        component = contract["component"]

        rules = contract["contract"]


        return {


            "target": component,


            "operations":[


                {

                    "action":"CREATE_CLASS",

                    "name":rules["class"]

                },


                {

                    "action":"ADD_METHOD",

                    "name":rules["method"]

                },


                {

                    "action":"VALIDATE_OUTPUT",

                    "keys":

                    rules["required_keys"]

                }

            ],


            "status":"PATCH_PLAN_CREATED"

        }

