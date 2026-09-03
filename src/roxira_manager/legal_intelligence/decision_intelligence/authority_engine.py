

class AuthorityEngine:


    PRIORITY = {

        "law": 1,
        "supreme_court": 2,
        "regulation": 3,
        "commentary":4

    }


    def rank(self, sources):


        ranked=[]


        for source in sources:

            if "ماده" in source:
                level="law"

            elif "رای" in source:
                level="supreme_court"

            else:
                level="commentary"


            ranked.append({

                "source":source,
                "authority":
                    self.PRIORITY[level]

            })


        ranked.sort(
            key=lambda x:x["authority"]
        )


        return {

            "ranked_sources":ranked,

            "status":"AUTHORITY_READY"

        }

