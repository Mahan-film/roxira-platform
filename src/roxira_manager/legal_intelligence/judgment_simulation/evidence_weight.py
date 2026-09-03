

class EvidenceWeight:


    def analyze(self, evidence):


        score=0


        score += len(evidence)*20


        return {

            "evidence_score":
            min(score,100),

            "status":
            "EVIDENCE_WEIGHTED"

        }

