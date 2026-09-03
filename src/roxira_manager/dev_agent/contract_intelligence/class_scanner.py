

import ast
from pathlib import Path


class ClassScanner:


    def scan(self,file):

        tree=ast.parse(
            Path(file).read_text(
                encoding="utf-8"
            )
        )


        classes={}


        for node in ast.walk(tree):

            if isinstance(node,ast.ClassDef):

                classes[node.name]=[

                    x.name

                    for x in node.body

                    if isinstance(
                        x,
                        ast.FunctionDef
                    )

                ]


        return classes

