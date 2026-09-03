

from pathlib import Path
import hashlib


class DuplicateDetector:


    def scan(self,root="src"):


        hashes={}

        duplicates=[]


        for file in Path(root).rglob("*.py"):


            try:

                content=file.read_text(
                    encoding="utf-8"
                )

                h=hashlib.md5(
                    content.encode()
                ).hexdigest()


                if h in hashes:

                    duplicates.append(
                        {
                        "file":str(file),
                        "duplicate_of":hashes[h]
                        }
                    )

                else:

                    hashes[h]=str(file)


            except Exception:
                pass



        return {

            "duplicates":duplicates,

            "count":len(duplicates),

            "status":"DUPLICATE_SCAN_DONE"

        }

