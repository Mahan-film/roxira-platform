
import ast
from pathlib import Path


class MethodUsageScanner:


    def scan(self, root="src"):


        usages=[]


        for file in Path(root).rglob("*.py"):


            try:

                source=file.read_text(
                    encoding="utf-8"
                )

                tree=ast.parse(source)


                for node in ast.walk(tree):


                    if isinstance(
                        node,
                        ast.Call
                    ):


                        if isinstance(
                            node.func,
                            ast.Attribute
                        ):


                            usages.append({

                                "file":str(file),

                                "method":
                                node.func.attr,

                                "line":
                                node.lineno

                            })


            except Exception:
                pass


        return {

            "usages":usages,

            "count":
            len(usages),

            "status":
            "METHOD_USAGE_READY"

        }

