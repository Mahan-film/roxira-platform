
class RenameEngine:


    def generate(
        self,
        old,
        new
    ):

        return {

            "operation":
            "RENAME_METHOD",

            "from":
            old,

            "to":
            new

        }

