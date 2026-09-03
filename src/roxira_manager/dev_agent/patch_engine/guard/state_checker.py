

from pathlib import Path


class CodeStateChecker:


    def check(
        self,
        file,
        old
    ):

        content=Path(file).read_text(
            encoding="utf-8"
        )


        if old in content:

            return {

                "exists":True,

                "action":"PATCH_REQUIRED"

            }


        return {

            "exists":False,

            "action":"ALREADY_FIXED_OR_CHANGED"

        }

