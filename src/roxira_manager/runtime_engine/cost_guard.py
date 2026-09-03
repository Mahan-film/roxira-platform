

class CostGuard:


    LIMITS={

        "free":100,

        "pro":5000,

        "max":20000

    }



    def allowed(
        self,
        tier,
        tokens
    ):

        return tokens <= self.LIMITS[tier]



