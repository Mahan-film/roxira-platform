

from pathlib import Path


class FileDetector:


    SUPPORTED={

        ".pdf":"pdf",

        ".docx":"document",

        ".txt":"text",

        ".md":"markdown",

        ".png":"image",

        ".jpg":"image"

    }



    def detect(self,path):

        ext=Path(path).suffix.lower()

        return self.SUPPORTED.get(
            ext,
            "unknown"
        )


