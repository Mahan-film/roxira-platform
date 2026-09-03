

from pathlib import Path
import datetime


class CodeExecutor:


    def __init__(self):

        self.allowed_paths=[

            "output_apps/smart_judge"

        ]



    def authorize(self, target):


        for path in self.allowed_paths:

            if target.startswith(path):

                return {

                    "allowed":True,

                    "status":"AUTHORIZED"

                }


        return {

            "allowed":False,

            "status":"BLOCKED"

        }



    def create_snapshot(self,target):


        return {

            "target":target,

            "time":

            datetime.datetime.now().isoformat(),

            "status":"SNAPSHOT_CREATED"

        }



    def prepare_execution(self,patch):


        auth=self.authorize(

            patch["target"]

        )


        if not auth["allowed"]:

            return {

                "status":"EXECUTION_BLOCKED"

            }


        return {

            "patch":patch,

            "snapshot":

            self.create_snapshot(

                patch["target"]

            ),

            "status":

            "EXECUTION_READY"

        }

