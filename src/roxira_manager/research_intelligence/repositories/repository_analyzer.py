class RepositoryAnalyzer:


    def analyze(self,repository):

        return {

            "repository":repository,

            "metrics":{

                "quality":"UNKNOWN",

                "activity":"UNKNOWN"

            },

            "status":"ANALYZED"

        }
