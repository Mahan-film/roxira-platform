

class LLMRouter:


    def select(self,task):

        if "legal" in task.lower():

            return {
                "model":"deepseek-reasoner",
                "mode":"reasoning"
            }


        return {
            "model":"deepseek-chat",
            "mode":"general"
        }

