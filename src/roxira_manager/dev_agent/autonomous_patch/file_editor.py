

from pathlib import Path


class FileEditor:


    def replace(

        self,

        file,

        old,

        new

    ):


        path=Path(file)


        content=path.read_text(
            encoding="utf-8"
        )


        if old not in content:

            return {

                "status":
                "TARGET_NOT_FOUND"

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

            "status":
            "UPDATED",

            "file":
            file

        }

