

class SelfCorrectionLoop:


    def analyze_critic(self, critic):

        errors = critic.get(
            "errors",
            []
        )


        if len(errors) == 0:

            return {

                "action":"ACCEPT",
                "reason":"No errors detected"

            }


        return {

            "action":"REGENERATE",

            "issues":errors,

            "instruction":
            """
            Regenerate legal answer.
            Fix all detected errors.
            Verify citations.
            Verify jurisdiction.
            Use grounded legal sources.
            """

        }



    def improve(self, answer, critic):


        decision = self.analyze_critic(
            critic
        )


        return {

            "previous_answer":answer,

            "correction_plan":decision,

            "status":
            decision["action"]

        }



