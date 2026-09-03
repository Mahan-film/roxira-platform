

import subprocess



class TestRunner:


    def run(self,command):


        result=subprocess.run(

            command,

            shell=True,

            capture_output=True,

            text=True

        )


        return {

            "success":
            result.returncode==0,


            "stdout":
            result.stdout,


            "stderr":
            result.stderr

        }

