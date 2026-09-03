

class LegalChunker:


    def split(self, document):


        chunks = document.split("\n")


        return {

            "chunks":
                [
                    c for c in chunks
                    if c.strip()
                ],

            "status":
            "CHUNKING_READY"

        }

