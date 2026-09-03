

class PermissionEngine:


    LEVELS={

        "free":1,

        "pro":2,

        "max":3

    }



    def allowed(
        self,
        user_tier,
        required
    ):

        return (

            self.LEVELS[user_tier]

            >=

            self.LEVELS[required]

        )


