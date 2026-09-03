
import ast
from pathlib import Path


class ImportScanner:


    def scan(self,file):

        imports=[]


        tree=ast.parse(
            Path(file).read_text(
                encoding="utf-8"
            )
        )


        for node in ast.walk(tree):

            if isinstance(node,ast.Import):

                for x in node.names:

                    imports.append(x.name)


            if isinstance(node,ast.ImportFrom):

                if node.module:

                    imports.append(
                        node.module
                    )


        return imports

