

class ModelSelector:


    def choose(self,task):

        if "architecture" in task or "legal" in task:

            return {

                "model":"deepseek-reasoner",

                "mode":"reasoning"

            }


        return {

            "model":"deepseek-chat",

            "mode":"general"

        }

