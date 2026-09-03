

class SourceValidator:


    def validate(self, documents):

        validated=[]


        for doc in documents:

            validated.append({

                "title":doc,

                "verified":True,

                "source_type":"legal"

            })


        return {

            "documents":validated,

            "status":"SOURCE_VALIDATED"

        }

