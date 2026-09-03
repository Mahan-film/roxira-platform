

import subprocess


class Checkpoint:


    def create(self,message):

        subprocess.run(
            "git add .",
            shell=True
        )


        subprocess.run(
            f'git commit -m "{message}"',
            shell=True
        )


        return {

            "status":
            "CHECKPOINT_CREATED"

        }

