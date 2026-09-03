from __future__ import annotations


from src.roxira_manager.legal_engine.jurisdiction_engine import (
    JurisdictionEngine
)

from src.roxira_manager.legal_engine.precedent_ranker import (
    PrecedentRanker
)



class DecisionPipeline:


    def __init__(self):

        self.jurisdiction = JurisdictionEngine()

        self.precedents = PrecedentRanker()



    def analyze(self, case, research):


        return {

            "jurisdiction":
            self.jurisdiction.analyze(case),


            "legal_authorities":
            self.precedents.rank(
                research["sources"]
            ),


            "status":
            "DECISION_READY"

        }
