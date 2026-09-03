

from .provider import AIProvider



class AIGateway:


    def __init__(self):

        self.provider=AIProvider()



    def prepare_request(
        self,
        model,
        prompt,
        tier
    ):


        return {

            "model":model,

            "prompt":prompt,

            "tier":tier,

            "provider":
            "openrouter",

            "status":
            "REQUEST_READY"

        }



