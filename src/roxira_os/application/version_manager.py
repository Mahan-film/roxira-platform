

class VersionManager:


    def compare(
        self,
        current,
        latest
    ):


        return {

            "current":current,

            "latest":latest,

            "update_available":
            current != latest

        }

