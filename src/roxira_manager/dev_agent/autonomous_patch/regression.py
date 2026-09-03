

import subprocess



class RegressionRunner:


    def run(self,test):


        result=subprocess.run(

            test,

            shell=True,

            capture_output=True,

            text=True

        )


        return {


            "passed":
            result.returncode==0,


            "output":
            result.stdout + result.stderr

        }

