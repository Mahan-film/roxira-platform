
import ast
from pathlib import Path


class APIContractAnalyzer:


    def analyze_class(self, file_path, class_name):

        source = Path(file_path).read_text(
            encoding="utf-8"
        )

        tree = ast.parse(source)


        methods = []


        for node in ast.walk(tree):

            if isinstance(node, ast.ClassDef):

                if node.name == class_name:


                    for item in node.body:


                        if isinstance(
                            item,
                            ast.FunctionDef
                        ):

                            args = [
                                a.arg
                                for a in item.args.args
                            ]


                            methods.append({

                                "name":
                                item.name,

                                "arguments":
                                args,

                                "line":
                                item.lineno

                            })


        return {

            "class":
            class_name,

            "methods":
            methods,

            "status":
            "API_CONTRACT_ANALYZED"

        }

