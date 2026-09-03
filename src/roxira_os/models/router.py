

class ModelRouter:


    MODELS={


        "free":{

            "model":"openrouter/free",

            "tokens":2000

        },


        "pro":{

            "model":"deepseek/deepseek-chat",

            "tokens":6000

        },


        "max":{

            "model":"deepseek/deepseek-reasoner",

            "tokens":12000

        }

    }



    def select(self,tier):

        return self.MODELS.get(

            tier,

            self.MODELS["free"]

        )

