
import ast
import sys
from pathlib import Path


class SmartAPIAnalyzer:


    def scan(self, root="src"):


        internal=set()
        calls=set()


        for file in Path(root).rglob("*.py"):

            try:

                tree=ast.parse(
                    file.read_text(
                        encoding="utf-8"
                    )
                )


                for node in ast.walk(tree):

                    if isinstance(node, ast.FunctionDef):

                        internal.add(
                            node.name
                        )


                    if isinstance(node, ast.Call):

                        if isinstance(
                            node.func,
                            ast.Attribute
                        ):

                            calls.add(
                                node.func.attr
                            )


            except Exception:
                pass



        builtin=set(dir(__builtins__))


        ignored=set(
            dir(Path)
        )


        missing=[]


        for call in calls:

            if (
                call not in internal
                and
                call not in builtin
                and
                call not in ignored
            ):

                missing.append(call)



        return {

            "internal_methods":len(internal),

            "possible_missing":sorted(
                missing
            ),

            "status":
            "SMART_API_ANALYSIS_DONE"

        }

