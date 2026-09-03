
class LegalDocumentSchema:

    def create(
        self,
        title,
        source,
        category,
        content
    ):

        return {

            "id": title.replace(" ","_"),

            "title": title,

            "source": source,

            "category": category,

            "content": content,

            "metadata": {

                "language":"fa",

                "type":"legal_document",

                "version":"1.0"

            }

        }

