

class DiffGenerator:


    def create(
        self,
        patch
    ):


        return {

            "patch":

            f"""
Replace:

{patch['from']}

With:

{patch['to']}
""",

            "status":
            "PATCH_READY"

        }

