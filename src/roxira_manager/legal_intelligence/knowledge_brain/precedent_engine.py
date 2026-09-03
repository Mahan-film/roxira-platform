

class PrecedentEngine:


    def analyze(self, case_type):


        precedents=[]


        if case_type=="property":

            precedents=[

                "رای وحدت رویه 805",
                "رای وحدت رویه 811"

            ]


        return {

            "precedents":precedents,

            "status":"PRECEDENT_READY"

        }

