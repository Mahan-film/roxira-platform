
import subprocess


class RealPatchBridge:


    def run_agent(self, agent, task):

        commands = {

            "opencode":[
                "opencode",
                "run",
                task
            ],

            "aider":[
                "aider",
                "--message",
                task
            ]

        }


        if agent not in commands:

            return {

                "status":"AGENT_NOT_FOUND"

            }


        process=subprocess.run(

            commands[agent],

            capture_output=True,

            text=True,

            timeout=900

        )


        return {

            "agent":agent,

            "stdout":process.stdout,

            "stderr":process.stderr,

            "exit_code":process.returncode,

            "status":"REAL_EXECUTION_DONE"

        }



    def run_tests(self):


        result=subprocess.run(

            [

                "pytest"

            ],

            capture_output=True,

            text=True,

            timeout=900

        )


        return {

            "stdout":result.stdout,

            "stderr":result.stderr,

            "exit_code":result.returncode,

            "status":"TEST_COMPLETED"

        }

