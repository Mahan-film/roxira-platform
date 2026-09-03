

from pathlib import Path
import hashlib


class SmartDuplicateDetector:


    def scan(self,root="src"):


        files={}

        duplicates=[]


        for file in Path(root).rglob("*.py"):


            if file.name=="__init__.py":
                continue


            try:

                text=file.read_text(
                    encoding="utf-8"
                ).strip()


                if len(text)<200:
                    continue


                digest=hashlib.sha256(
                    text.encode()
                ).hexdigest()



                if digest in files:

                    duplicates.append(
                        {
                        "file":str(file),
                        "same_as":files[digest]
                        }
                    )


                else:

                    files[digest]=str(file)



            except Exception:
                pass



        return {

            "duplicates":duplicates,

            "count":len(duplicates),

            "status":
            "SMART_DUPLICATE_DONE"

        }

