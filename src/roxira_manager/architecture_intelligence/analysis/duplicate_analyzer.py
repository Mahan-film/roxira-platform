class DuplicateAnalyzer:


    def analyze(self,components):

        duplicates=[]

        names=list(components.keys())


        for name in names:

            if names.count(name)>1:

                duplicates.append(name)


        return {

            "duplicates":duplicates,

            "status":"ANALYZED"

        }
