
import subprocess


class GitGuard:


    def status(self):

        result = subprocess.run(
            ["git","status","--short"],
            capture_output=True,
            text=True
        )

        return {
            "changes": result.stdout.splitlines(),
            "status":"CHECKED"
        }


    def checkpoint(self,message):

        subprocess.run(
            ["git","add","."],
            capture_output=True
        )

        subprocess.run(
            [
                "git",
                "commit",
                "-m",
                message
            ],
            capture_output=True
        )

        return {
            "commit":message,
            "status":"CHECKPOINT_CREATED"
        }


    def rollback(self):

        subprocess.run(
            [
                "git",
                "reset",
                "--hard",
                "HEAD"
            ],
            capture_output=True
        )

        return {
            "status":"ROLLED_BACK"
        }

