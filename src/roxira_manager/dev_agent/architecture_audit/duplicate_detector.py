

import hashlib
from pathlib import Path


class DuplicateDetector:


    def scan(self,files):

        hashes={}

        duplicates=[]


        for file in files:


            content=Path(file).read_text(
                encoding="utf-8"
            )


            h=hashlib.md5(
                content.encode()
            ).hexdigest()


            if h in hashes:

                duplicates.append(
                    {
                    "file":file,
                    "duplicate_of":hashes[h]
                    }
                )

            else:

                hashes[h]=file


        return duplicates

