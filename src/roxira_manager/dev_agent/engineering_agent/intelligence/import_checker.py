

import ast
from pathlib import Path



class ImportChecker:


    def scan(self,root="src"):


        errors=[]


        for file in Path(root).rglob("*.py"):


            try:

                tree=ast.parse(
                    file.read_text(
                        encoding="utf-8"
                    )
                )


                for node in ast.walk(tree):

                    if isinstance(node,ast.Import):

                        pass


                    if isinstance(node,ast.ImportFrom):

                        if node.module is None:

                            errors.append(
                                str(file)
                            )


            except Exception as e:

                errors.append(
                    str(file)
                )


        return {

            "errors":errors,

            "count":len(errors),

            "status":"IMPORT_SCAN_DONE"

        }

