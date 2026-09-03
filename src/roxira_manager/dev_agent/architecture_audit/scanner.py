
from pathlib import Path


class ModuleScanner:


    def scan(self,root="src"):

        files=[]

        for p in Path(root).rglob("*.py"):

            if "__pycache__" not in str(p):

                files.append(str(p))


        return files

