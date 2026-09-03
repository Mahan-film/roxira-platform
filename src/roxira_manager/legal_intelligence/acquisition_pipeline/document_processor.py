

class LegalDocumentProcessor:


    def process(self, document):

        return {

            "raw": document,

            "normalized":
                document.strip(),

            "metadata":{

                "type":"legal_document",
                "language":"fa"

            },

            "status":
            "DOCUMENT_PROCESSED"

        }

