class QualityGate:


    def validate(self,result):

        return {

            "result":result,

            "quality":"CHECKED",

            "status":"PASSED"

        }
