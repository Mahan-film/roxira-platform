from pathlib import Path
import json


class RoxiraIngestion:


    def __init__(self, root):

        self.root = Path(root)


    def scan(self):

        result = []

        for item in self.root.rglob("*"):

            if item.is_file():

                result.append(
                    {
                        "file":
                        str(item),

                        "extension":
                        item.suffix
                    }
                )

        return result



    def save(self,data):

        Path(
            "project_memory/discovery"
        ).mkdir(
            exist_ok=True
        )


        with open(
            "project_memory/discovery/file_inventory.json",
            "w"
        ) as f:

            json.dump(
                data,
                f,
                indent=2
            )


if __name__ == "__main__":


    engine = RoxiraIngestion(
        "."
    )

    data = engine.scan()

    engine.save(data)


    print(
        f"{len(data)} files indexed"
    )