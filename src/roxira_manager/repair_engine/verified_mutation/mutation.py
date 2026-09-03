
import subprocess
from pathlib import Path


class VerifiedMutation:


    def __init__(self):

        self.allowed=[
            "output_apps/smart_judge"
        ]


    def verify_target(self,target):

        return any(

            target.startswith(x)

            for x in self.allowed

        )


    def execute(self,agent,target,instruction):


        if not self.verify_target(target):

            return {

                "status":
                "BLOCKED_PATH"

            }


        prompt=f"""

You are a coding agent.

Task:

{instruction}


Mandatory:

1. Open target file.
2. Modify the file directly.
3. Do not only explain.
4. Save changes.
5. Run syntax check.
6. Return changed files.

Target:

{target}

"""


        result=subprocess.run(

            [
                agent,
                "run",
                prompt
            ],

            capture_output=True,

            text=True,

            timeout=900

        )


        return {


            "agent":agent,

            "target":target,

            "stdout":
            result.stdout[-5000:],


            "stderr":
            result.stderr[-2000:],


            "exit_code":
            result.returncode,


            "status":
            "MUTATION_ATTEMPTED"

        }

