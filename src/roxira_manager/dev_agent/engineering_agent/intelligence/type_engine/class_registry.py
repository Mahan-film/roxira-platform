
import ast
from pathlib import Path


class ClassRegistry:


    def scan(self,root="src"):


        registry={}


        for file in Path(root).rglob("*.py"):


            try:

                tree=ast.parse(
                    file.read_text(
                        encoding="utf-8"
                    )
                )


                for node in ast.walk(tree):


                    if isinstance(
                        node,
                        ast.ClassDef
                    ):


                        methods=[]


                        for item in node.body:

                            if isinstance(
                                item,
                                ast.FunctionDef
                            ):

                                methods.append(
                                    item.name
                                )


                        registry[node.name]={
                            "file":str(file),
                            "methods":methods
                        }


            except Exception:
                pass



        return {

            "classes":registry,

            "count":len(registry),

            "status":
            "CLASS_REGISTRY_READY"

        }

