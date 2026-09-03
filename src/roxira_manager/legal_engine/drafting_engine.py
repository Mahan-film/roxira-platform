from __future__ import annotations


class DraftingEngine:


    def generate(self, case, analysis):


        return {

            "document_type":
            "دادخواست",

            "title":
            case.get("description"),


            "legal_basis":
            analysis.get(
                "legal_authorities",
                []
            ),


            "required_evidence":
            analysis.get(
                "evidence",
                []
            ),


            "status":
            "DRAFT_READY"

        }

