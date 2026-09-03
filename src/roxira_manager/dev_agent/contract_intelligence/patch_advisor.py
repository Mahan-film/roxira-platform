

class PatchAdvisor:


    def suggest(self,result):


        if not result["valid"]:


            return {

            "action":
            "CREATE_PATCH",

            "priority":
            "HIGH",

            "missing":
            result["missing"]

            }


        return {

        "action":
        "NO_CHANGE"

        }

