

import subprocess
from pathlib import Path



class PatchApplyEngine:


    def __init__(self):

        self.logs=[]



    def execute_agent(self,agent,task,target):


        command=[

            agent,

            "run",

            task

        ]


        try:


            result=subprocess.run(

                command,

                capture_output=True,

                text=True,

                timeout=900

            )


            record={


                "agent":agent,

                "target":target,

                "stdout":result.stdout[-4000:],


                "stderr":result.stderr[-4000:],


                "exit_code":result.returncode,


                "status":

                "AGENT_FINISHED"

            }


            self.logs.append(record)


            return record



        except subprocess.TimeoutExpired:


            return {


                "agent":agent,

                "status":"TIMEOUT"

            }



    def get_history(self):


        return {


            "items":len(self.logs),

            "logs":self.logs

        }

