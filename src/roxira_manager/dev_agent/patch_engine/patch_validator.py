

class PatchValidator:


    def validate(
        self,
        patch
    ):


        required=[

            "operation",
            "from",
            "to"

        ]


        valid=all(

            x in patch

            for x in required

        )


        return {

            "valid":
            valid,

            "status":
            "VALIDATED"

            if valid

            else

            "INVALID"

        }

