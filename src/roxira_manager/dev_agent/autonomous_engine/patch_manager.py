

from pathlib import Path



class PatchManager:


    def apply(self,file_path,old,new):


        path=Path(file_path)


        content=path.read_text(
            encoding="utf-8"
        )


        if old not in content:

            return {

                "status":"FAILED",

                "reason":"TARGET_NOT_FOUND"

            }



        content=content.replace(
            old,
            new
        )


        path.write_text(
            content,
            encoding="utf-8"
        )


        return {

            "status":"PATCH_APPLIED",

            "file":file_path

        }

