
import ast
from pathlib import Path


class DependencyGraph:


    def build(self,root="src"):


        graph={}


        for file in Path(root).rglob("*.py"):


            if "__pycache__" in str(file):

                continue


            try:

                tree=ast.parse(

                    file.read_text(
                        encoding="utf-8"
                    )

                )


            except:

                continue



            imports=[]


            for node in ast.walk(tree):


                if isinstance(
                    node,
                    ast.ImportFrom
                ):


                    if node.module:

                        imports.append(
                            node.module
                        )


                elif isinstance(
                    node,
                    ast.Import
                ):


                    for item in node.names:

                        imports.append(
                            item.name
                        )


            graph[str(file)]=imports


        return graph

