from __future__ import annotations


from .case_understanding import CaseUnderstandingEngine
from .legal_strategy import LegalStrategyEngine



class ReasoningPipeline:


    def __init__(self):

        self.understanding = CaseUnderstandingEngine()

        self.strategy = LegalStrategyEngine()



    def execute(self, case):


        analysis = self.understanding.analyze(
            case
        )


        strategy = self.strategy.build(
            analysis
        )


        return {

            "case_analysis":
            analysis,

            "legal_strategy":
            strategy,

            "status":
            "REASONING_READY"

        }
