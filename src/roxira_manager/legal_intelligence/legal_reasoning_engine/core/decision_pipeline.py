

from .citation_mapper import CitationMapper
from .evidence_mapper import EvidenceMapper


class DecisionPipeline:


    def run(self, case, issues, strategy, risks):


        citations = CitationMapper().map(
            issues["issues"]
        )


        evidence = EvidenceMapper().map(
            issues["issues"]
        )


        return {

            "case":case,

            "issues":issues,

            "strategy":strategy,

            "risks":risks,

            "citations":citations,

            "evidence":evidence,

            "status":"LEGAL_DECISION_READY"

        }

