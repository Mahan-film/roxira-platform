
import subprocess


class RealOpenCodeExecutor:


    def run(self, task, workspace="."):


        command = [

            "opencode",

            task

        ]


        result = subprocess.run(

            command,

            cwd=workspace,

            capture_output=True,

            text=True

        )


        return {

            "return_code":
            result.returncode,

            "stdout":
            result.stdout,

            "stderr":
            result.stderr

        }

