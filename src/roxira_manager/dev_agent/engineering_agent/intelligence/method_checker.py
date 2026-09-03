
import ast
from pathlib import Path


class MethodChecker:


    def scan(self, root="src"):

        classes={}

        for file in Path(root).rglob("*.py"):

            try:

                tree=ast.parse(
                    file.read_text(
                        encoding="utf-8"
                    )
                )

                for node in ast.walk(tree):

                    if isinstance(node, ast.ClassDef):

                        methods=[]

                        for item in node.body:

                            if isinstance(item, ast.FunctionDef):

                                methods.append(item.name)


                        classes[node.name]=methods


            except Exception:
                pass


        return {

            "classes":classes,

            "status":"METHOD_MAP_READY"

        }

