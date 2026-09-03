

class LegalChangeDetector:


    def compare(self,old,new):


        if old != new:

            return {

                "changed":True,

                "action":
                "REINDEX_KNOWLEDGE"

            }


        return {

            "changed":False

        }



