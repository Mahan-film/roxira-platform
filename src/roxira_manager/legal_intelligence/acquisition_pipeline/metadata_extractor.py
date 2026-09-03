

class MetadataExtractor:


    def extract(self, text):


        category="general"


        if "ماده" in text:

            category="law"


        return {

            "title":text[:50],

            "category":category,

            "status":
            "METADATA_READY"

        }

