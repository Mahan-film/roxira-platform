

class LegalCorrectionEngine:


    def should_retry(self,critic):


        errors = critic.get(
            "errors",
            []
        )


        return len(errors) > 0



    def build_retry_prompt(self,critic):


        return {

            "instruction":
            "Regenerate answer after fixing errors",

            "errors":
            critic.get(
                "errors",
                []
            )

        }


