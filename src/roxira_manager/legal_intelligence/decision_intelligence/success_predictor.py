

class SuccessPredictor:


    def predict(
        self,
        issues,
        evidence
    ):


        score=0


        if "official_deed_transfer" in issues:
            score +=40


        if len(evidence)>2:
            score +=30


        if "property_transaction" in issues:
            score +=20


        return {


            "success_probability":
                min(score,95),


            "status":
                "PREDICTION_READY"

        }


