

from .parser import ErrorParser

from .classifier import ErrorClassifier



class ErrorDiagnosis:


    def __init__(self):

        self.parser=ErrorParser()

        self.classifier=ErrorClassifier()



    def analyze(self,result):


        parsed=self.parser.parse(
            result
        )


        solution=self.classifier.classify(

            parsed["error_type"]

        )


        return {


            "error":
            parsed,


            "recommended_agent":
            solution

        }

