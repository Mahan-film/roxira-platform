

class LearningStore:


    def __init__(self):

        self.memory=[]


    def remember(self,item):

        self.memory.append(item)


        return {

            "stored":
            True,

            "total":
            len(self.memory)

        }

