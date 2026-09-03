

class PatchPlanner:


    def create_patch(self,contract_result):

        if contract_result["valid"]:

            return {
                "action":"NO_CHANGE",
                "status":"SAFE"
            }


        missing = contract_result.get(
            "missing",
            []
        )


        return {

            "action":"CREATE_PATCH",

            "missing":missing,

            "priority":"HIGH",

            "status":"PATCH_READY"

        }

