

import ast
from pathlib import Path


class ChangeImpactAnalyzer:


    def scan_file(self,file_path):

        path=Path(file_path)

        if not path.exists():

            return {
                "status":"FILE_NOT_FOUND"
            }


        tree=ast.parse(
            path.read_text()
        )


        classes=[]
        methods=[]


        for node in ast.walk(tree):

            if isinstance(node,ast.ClassDef):

                classes.append(node.name)


            if isinstance(node,ast.FunctionDef):

                methods.append(node.name)


        return {

            "file":str(path),

            "classes":classes,

            "methods":methods,

            "status":"SCANNED"

        }



    def check_method_change(self,
                            old,
                            new,
                            files):


        impact=[]


        for file in files:

            result=self.scan_file(file)


            if old in result.get("methods",[]):

                impact.append(
                    {
                    "file":file,
                    "affected":True
                    }
                )


        return {

            "old":old,

            "new":new,

            "impact":impact,

            "status":"IMPACT_ANALYZED"

        }

