

class ChangeTracker:


    def compare(
        self,
        old,
        new
    ):


        if old != new:

            return {

                "changed":True,

                "action":
                "CREATE_NEW_VERSION"

            }


        return {

            "changed":False

        }

