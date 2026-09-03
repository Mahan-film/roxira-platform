from __future__ import annotations


class PrecedentRanker:


    def rank(self, sources):

        ranked=[]


        for item in sources.get("results",[]):

            payload=item.get("payload",{})

            score=item.get("score",0)


            ranked.append({

                "title":
                payload.get("title"),

                "category":
                payload.get("category"),

                "authority_score":
                score

            })


        return sorted(
            ranked,
            key=lambda x:x["authority_score"],
            reverse=True
        )
