

class RollbackManager:


    def restore(self):

        import subprocess


        subprocess.run(
            "git checkout -- .",
            shell=True
        )


        return {

            "status":
            "ROLLED_BACK"

        }

