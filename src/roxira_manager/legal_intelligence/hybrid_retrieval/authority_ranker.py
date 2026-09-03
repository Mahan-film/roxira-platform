

class AuthorityRanker:


    def rank(self, documents):

        for doc in documents:

            score = doc.get("score",0)

            if doc.get("type")=="graph":

                score += 0.10


            doc["authority_score"]=round(score,2)


        return sorted(

            documents,

            key=lambda x:x["authority_score"],

            reverse=True

        )

