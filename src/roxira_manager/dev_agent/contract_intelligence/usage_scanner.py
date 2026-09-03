

import ast



class UsageScanner:


    def scan(self,file):


        tree=ast.parse(

            open(
                file,
                encoding="utf-8"
            ).read()

        )


        calls=[]


        for node in ast.walk(tree):

            if isinstance(
                node,
                ast.Call
            ):


                if isinstance(
                    node.func,
                    ast.Attribute
                ):

                    calls.append(
                        node.func.attr
                    )


        return calls

