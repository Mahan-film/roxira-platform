
import ast
from pathlib import Path


class APIContractChecker:


    def scan(self, root="src"):

        methods={}
        calls=[]


        for file in Path(root).rglob("*.py"):

            try:

                tree=ast.parse(
                    file.read_text(
                        encoding="utf-8"
                    )
                )


                for node in ast.walk(tree):

                    if isinstance(node, ast.FunctionDef):

                        methods[node.name]=str(file)


                    if isinstance(node, ast.Call):

                        if isinstance(node.func, ast.Attribute):

                            calls.append(
                                node.func.attr
                            )

            except Exception:
                pass


        missing=[]


        for call in calls:

            if call not in methods:

                missing.append(call)


        return {

            "known_methods":len(methods),

            "missing_calls":list(set(missing)),

            "status":"API_CONTRACT_ANALYZED"

        }

