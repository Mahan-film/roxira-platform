

class ModelPolicy:


    MODELS={

        "free":
        {
            "model":"openrouter/free",
            "max_tokens":2000
        },


        "pro":
        {
            "model":"deepseek/deepseek-chat",
            "max_tokens":6000
        },


        "max":
        {
            "model":"deepseek/deepseek-reasoner",
            "max_tokens":12000
        }

    }



    def select(self,tier):

        return self.MODELS.get(
            tier,
            self.MODELS["free"]
        )



