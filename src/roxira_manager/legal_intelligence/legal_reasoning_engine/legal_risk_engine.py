

class LegalRiskEngine:


    def analyze(self,case):

        risks=[]


        if "عادی" in case:

            risks.append(
                "ordinary_contract_validation"
            )


        if "کلاهبرداری" in case:

            risks.append(
                "criminal_evidence_required"
            )


        return {

            "risks":risks,

            "status":"RISK_ANALYZED"

        }

