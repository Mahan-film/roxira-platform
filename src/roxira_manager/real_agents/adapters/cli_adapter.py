
import subprocess


class CLIAdapter:


    def run(self,command,args):

        try:

            result=subprocess.run(
                [command]+args,
                cwd=".",
                capture_output=True,
                text=True,
                timeout=600
            )


            return {
                "command":command,
                "stdout":result.stdout,
                "stderr":result.stderr,
                "exit_code":result.returncode,
                "status":"EXECUTED"
            }


        except Exception as e:

            return {
                "error":str(e),
                "status":"FAILED"
            }

