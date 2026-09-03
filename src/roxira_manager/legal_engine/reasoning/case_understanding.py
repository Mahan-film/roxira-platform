from __future__ import annotations


class CaseUnderstandingEngine:


    def analyze(self, case):

        description = case.get(
            "description",
            ""
        )


        result = {

            "raw_case":
            description,

            "category":
            case.get(
                "category",
                "unknown"
            ),

            "identified_issues": [],

            "possible_claims": [],

            "required_analysis": []

        }


        if "ملک" in description:

            result["identified_issues"].append(
                "property_dispute"
            )


        if "سند" in description:

            result["possible_claims"].append(
                "obligation_to_transfer_official_deed"
            )


        if "خسارت" in description:

            result["possible_claims"].append(
                "damage_claim"
            )


        result["required_analysis"].extend([

            "jurisdiction",
            "legal_basis",
            "evidence",
            "procedure"

        ])


        return result
