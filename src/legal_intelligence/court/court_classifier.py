from __future__ import annotations


class CourtClassifier:

    def classify(self, case_text: str):

        text = case_text.lower()

        if any(x in text for x in [
            "طلاق",
            "مهریه",
            "نفقه",
            "حضانت"
        ]):
            return {
                "category": "family",
                "court": "family_court"
            }


        if any(x in text for x in [
            "سرقت",
            "کلاهبرداری",
            "خیانت در امانت",
            "جرم"
        ]):
            return {
                "category": "criminal",
                "court": "criminal_prosecution"
            }


        if any(x in text for x in [
            "قرارداد",
            "مطالبه",
            "ملک",
            "الزام به تنظیم سند",
            "خسارت"
        ]):
            return {
                "category": "civil",
                "court": "general_civil_court"
            }


        return {
            "category": "unknown",
            "court": "needs_review"
        }
