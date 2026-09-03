from __future__ import annotations


class JurisdictionEngine:


    def determine(self, case):

        category = case.get("category")


        mapping = {

            "civil": {
                "first_instance": "general_civil_court",
                "appeal": "provincial_court_of_appeal"
            },

            "criminal": {
                "first_instance": "criminal_court",
                "investigation": "prosecution"
            },

            "family": {
                "first_instance": "family_court",
                "appeal": "provincial_court_of_appeal"
            }
        }


        return mapping.get(
            category,
            {
                "status":"manual_review"
            }
        )
