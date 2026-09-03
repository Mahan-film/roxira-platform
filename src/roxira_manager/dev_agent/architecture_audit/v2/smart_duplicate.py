
from pathlib import Path
import ast
import hashlib


class SmartDuplicateDetector:


    def normalize(self,content):

        try:

            tree=ast.parse(content)

            return ast.dump(tree)

        except:

            return content.strip()



    def scan(self,files):


        registry={}

        duplicates=[]


        for file in files:


            path=Path(file)


            if path.name=="__init__.py":

                continue


            content=path.read_text(
                encoding="utf-8"
            )


            if len(content.strip()) < 50:

                continue



            normalized=self.normalize(content)



            fingerprint=hashlib.sha256(

                normalized.encode()

            ).hexdigest()



            if fingerprint in registry:


                duplicates.append({

                    "file":file,

                    "duplicate_of":
                    registry[fingerprint]

                })


            else:

                registry[fingerprint]=file



        return duplicates

