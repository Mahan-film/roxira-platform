
import subprocess


class AgentRuntimeConnector:


    COMMANDS={

        "opencode":
        [
            "opencode",
            "run"
        ],


        "aider":
        [
            "aider",
            "--message"
        ]

    }



    def execute(self, agent, task):


        if agent not in self.COMMANDS:

            return {

                "agent":agent,

                "status":"UNSUPPORTED_AGENT"

            }



        command = (

            self.COMMANDS[agent]

            +

            [task]

        )



        try:


            result=subprocess.run(

                command,

                capture_output=True,

                text=True,

                timeout=300

            )


            return {


                "agent":agent,


                "stdout":

                result.stdout[-3000:],


                "stderr":

                result.stderr[-3000:],


                "exit_code":

                result.returncode,


                "status":

                "EXECUTION_COMPLETED"

            }



        except subprocess.TimeoutExpired:


            return {


                "agent":agent,

                "status":

                "EXECUTION_TIMEOUT"

            }

