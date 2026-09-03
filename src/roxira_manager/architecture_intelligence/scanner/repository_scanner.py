from pathlib import Path


class RepositoryScanner:


    def scan(self,root="src/roxira_manager"):

        result=[]

        for p in Path(root).rglob("*.py"):

            result.append(
                str(p)
            )

        return result
