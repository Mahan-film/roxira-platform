"""
ROXIRA LEGAL JURISDICTION ENGINE

Determines:
- court type
- legal path
- parallel actions
"""


class JurisdictionEngine:


    def analyze(self, case):

        text = case.lower()


        result = {

            "category": "unknown",

            "courts": [],

            "actions": [],

            "confidence": 0.0

        }


        if any(
            x in text
            for x in [
                "ملک",
                "سند",
                "مبایعه",
                "فروشنده"
            ]
        ):

            result.update({

                "category":"civil_property",

                "courts":[
                    "general_civil_court"
                ],

                "actions":[
                    "obligation_to_transfer_official_deed",
                    "damage_claim_if_contractual"
                ],

                "confidence":0.85

            })


        if any(
            x in text
            for x in [
                "کلاهبرداری",
                "جعل",
                "خیانت"
            ]
        ):

            result["actions"].append(
                "criminal_complaint"
            )

            result["courts"].append(
                "criminal_prosecution"
            )

            result["category"]="civil_and_criminal"

            result["confidence"]=0.9



        return result

