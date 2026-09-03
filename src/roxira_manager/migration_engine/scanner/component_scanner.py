from pathlib import Path


class ComponentScanner:


    def scan(self,root="src/roxira_manager"):

        result=[]

        path=Path(root)


        if path.exists():

            for item in path.iterdir():

                if item.is_dir():

                    result.append(item.name)


        return result
