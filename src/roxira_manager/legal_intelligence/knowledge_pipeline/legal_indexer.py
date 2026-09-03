

class LegalIndexer:


    def index(self,chunks):

        return {

            "indexed":True,

            "chunks":len(chunks),

            "engine":"qdrant"

        }


