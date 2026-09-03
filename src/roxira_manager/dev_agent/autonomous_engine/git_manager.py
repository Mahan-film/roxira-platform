

import subprocess



class GitManager:


    def status(self):

        return subprocess.getoutput(
            "git status --short"
        )



    def commit(self,message):

        subprocess.run(
            f'git add . && git commit -m "{message}"',
            shell=True
        )


        return {

            "status":
            "COMMITTED",

            "message":
            message

        }

