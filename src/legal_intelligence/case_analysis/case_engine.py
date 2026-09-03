from __future__ import annotations

from src.legal_intelligence.court.court_classifier import CourtClassifier
from src.legal_intelligence.jurisdiction.jurisdiction_engine import JurisdictionEngine


class CaseEngine:


    def __init__(self):

        self.classifier = CourtClassifier()
        self.jurisdiction = JurisdictionEngine()


    def analyze(self, text):

        case = self.classifier.classify(text)

        court = self.jurisdiction.determine(case)


        return {
            "case": case,
            "jurisdiction": court
        }



if __name__ == "__main__":

    engine = CaseEngine()

    result = engine.analyze(
        "دعوی الزام به تنظیم سند رسمی ملک و مطالبه خسارت"
    )

    print(result)
