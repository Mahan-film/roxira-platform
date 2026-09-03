

class ClaimantAnalyzer:


    def analyze(self, case):


        claims=[]


        if "ملک" in case:

            claims.append(
                "الزام به تنظیم سند رسمی"
            )


        return {

            "claims":claims,

            "status":
            "CLAIM_ANALYZED"

        }

