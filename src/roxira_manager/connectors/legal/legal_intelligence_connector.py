from __future__ import annotations

from src.legal_intelligence.case_analysis.case_engine import CaseEngine


class LegalIntelligenceConnector:


    def __init__(self):

        self.engine = CaseEngine()


    def analyze_case(self, case_text: str):

        return self.engine.analyze(case_text)
