

class PatchMemory:


    def __init__(self):

        self.history=[]



    def store(
        self,
        patch
    ):

        self.history.append(
            patch
        )


        return {

            "stored":
            True,

            "count":
            len(self.history)

        }

