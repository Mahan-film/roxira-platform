
import subprocess
import datetime


class PatchTransaction:


    def create_checkpoint(self):

        return {
            "time": datetime.datetime.now().isoformat(),
            "status": "CHECKPOINT_READY"
        }


    def execute_agent(self, agent, task):

        return {
            "agent": agent,
            "task": task,
            "status": "AGENT_TASK_READY"
        }


    def run_validation(self, target=None):

        """
        Targeted validation only.
        Never run whole repository tests here.
        """

        if target is None:

            target = (
                "src/roxira_manager"
            )


        command = [

            "python",

            "-m",

            "pytest",

            target,

            "-q",

            "--disable-warnings"

        ]


        try:

            result = subprocess.run(

                command,

                capture_output=True,

                text=True,

                timeout=120

            )


            return {

                "exit_code": result.returncode,

                "stdout":
                    result.stdout[-2000:],

                "stderr":
                    result.stderr[-2000:],


                "status":

                    "TEST_PASS"

                    if result.returncode == 0

                    else

                    "TEST_FAIL"

            }


        except subprocess.TimeoutExpired:


            return {

                "status":"TEST_TIMEOUT",

                "action":"ROLLBACK"

            }



    def commit_decision(self, test):


        if test["status"] == "TEST_PASS":

            return {

                "action":"COMMIT",

                "status":"APPROVED"

            }


        return {

            "action":"ROLLBACK",

            "status":"REJECTED"

        }

