
from pathlib import Path
from datetime import datetime
import subprocess
import shutil


class AutonomousPatchExecutor:


    def __init__(self):

        self.root = Path(".")
        self.history=[]


    def snapshot(self,target):

        backup = Path(
            str(target)+
            ".backup_"+
            datetime.now().strftime("%Y%m%d%H%M%S")
        )

        shutil.copy(
            target,
            backup
        )

        return {

            "backup":str(backup),

            "status":
            "SNAPSHOT_CREATED"

        }



    def apply_agent_patch(self,agent,task,target):


        result=subprocess.run(

            [
                agent,
                "run",
                task
            ],

            capture_output=True,

            text=True,

            timeout=900

        )


        record={

            "agent":agent,

            "target":target,

            "exit_code":
            result.returncode,

            "stdout":
            result.stdout[-3000:],


            "stderr":
            result.stderr[-3000:],


            "status":
            "PATCH_EXECUTION_FINISHED"

        }


        self.history.append(record)


        return record



    def validate(self,test):


        result=subprocess.run(

            test,

            shell=True,

            capture_output=True,

            text=True,

            timeout=120

        )


        if result.returncode==0:

            return {

                "status":
                "TEST_PASS",

                "commit":
                True

            }


        return {

            "status":
            "TEST_FAIL",

            "commit":
            False

        }

