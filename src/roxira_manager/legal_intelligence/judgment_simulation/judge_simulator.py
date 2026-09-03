

class JudgeSimulator:


    def simulate(
        self,
        claim,
        evidence_score,
        risks
    ):


        probability = evidence_score


        if risks:

            probability -= 10


        return {

            "probability":
            max(probability,0),

            "possible_result":
            "FAVORABLE"

            if probability >=60
            else
            "UNCERTAIN",

            "status":
            "JUDGMENT_SIMULATED"

        }

