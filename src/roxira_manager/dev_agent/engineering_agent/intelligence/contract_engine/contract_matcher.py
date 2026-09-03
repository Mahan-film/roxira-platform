

from difflib import SequenceMatcher


class ContractMatcher:


    def compare(
        self,
        available_methods,
        called_method
    ):


        if called_method in available_methods:

            return {

                "match":True,

                "status":
                "CONTRACT_VALID"

            }



        candidates=[]


        for method in available_methods:

            score=SequenceMatcher(
                None,
                called_method,
                method
            ).ratio()


            if score > 0.5:

                candidates.append({

                    "method":method,

                    "score":
                    round(score,2)

                })


        return {


            "match":False,

            "called":
            called_method,


            "candidates":
            candidates,


            "status":
            "CONTRACT_MISMATCH"

        }

