

class EvidenceMapper:


    def map(self, issues):

        evidence=[]


        if "property_transaction" in issues:
            evidence.extend([
                "مبایعه نامه",
                "رسید پرداخت ثمن",
                "مدارک هویتی"
            ])


        if "official_deed_transfer" in issues:
            evidence.extend([
                "گواهی عدم حضور دفترخانه",
                "استعلام ثبتی ملک"
            ])


        return {

            "evidence":list(set(evidence)),
            "status":"EVIDENCE_READY"

        }

