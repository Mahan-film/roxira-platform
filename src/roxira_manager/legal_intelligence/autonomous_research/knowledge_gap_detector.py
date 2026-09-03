

class KnowledgeGapDetector:


    def detect(self, case, existing):


        missing=[]


        if "قانون ثبت" not in existing:

            missing.append(
                "registration_law"
            )


        if "رای وحدت رویه" not in existing:

            missing.append(
                "supreme_court_precedents"
            )


        return {

            "missing":missing,

            "requires_research":
                len(missing)>0,

            "status":
                "GAP_ANALYZED"

        }

