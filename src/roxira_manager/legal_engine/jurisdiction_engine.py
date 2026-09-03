from __future__ import annotations

import json
from pathlib import Path



class JurisdictionEngine:


    def __init__(self):

        path = Path(
        "src/roxira_manager/knowledge/jurisdiction/jurisdiction_rules.json"
        )

        self.rules=json.loads(
            path.read_text()
        )["rules"]



    def analyze(self, case):

        category=case.get("category")


        if category=="criminal":

            return {
                "first_instance":
                "criminal_prosecution",

                "appeal":
                "criminal_appeal_court",

                "source":
                "jurisdiction_rules"
            }



        return {

            "first_instance":
            "general_civil_court",

            "appeal":
            "provincial_court_of_appeal",

            "source":
            "jurisdiction_rules"

        }

