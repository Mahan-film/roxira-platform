

import subprocess


class TestRunner:


    def run(self, command):


        result=subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True
        )


        return {

            "return_code":
            result.returncode,

            "output":
            result.stdout[-500:],

            "errors":
            result.stderr[-500:],


            "status":
            "PASSED"
            if result.returncode==0
            else
            "FAILED"

        }

