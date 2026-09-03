from __future__ import annotations


class EvidenceAnalyzer:


    def analyze(self, case):

        description = case.get(
            "description",
            ""
        )


        evidence=[]


        if "ملک" in description or "سند" in description:

            evidence.extend([
                "مبایعه نامه",
                "رسید پرداخت ثمن",
                "مدارک هویتی",
                "گواهی عدم حضور دفترخانه"
            ])


        if "قرارداد" in description:

            evidence.append(
                "اصل قرارداد و الحاقات"
            )


        return {

            "required_documents": evidence,

            "evidence_status":
            "ANALYZED"

        }

