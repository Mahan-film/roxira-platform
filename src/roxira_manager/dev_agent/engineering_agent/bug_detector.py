

class BugDetector:


    def analyze(self, test_result):


        if test_result["status"]=="FAILED":

            return {

                "bug_found":True,

                "type":"TEST_FAILURE",

                "details":
                test_result["errors"]

            }


        return {

            "bug_found":False

        }

