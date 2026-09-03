

class ModelRouter:


    def select(self,risk):

        if risk=="high":

            return {

                "model":"deepseek-reasoner",

                "mode":"reasoning"

            }


        return {

            "model":"deepseek-chat",

            "mode":"general"

        }

