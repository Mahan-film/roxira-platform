

from pathlib import Path


class ProjectScanner:


    def scan(self, root="src"):


        files=[]


        for path in Path(root).rglob("*.py"):

            files.append(
                str(path)
            )


        return {

            "files":files,

            "count":len(files),

            "status":"SCANNED"

        }

