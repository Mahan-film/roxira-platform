

class MemoryLoop:


    def __init__(self):

        self.history=[]


    def store(self,data):

        self.history.append(data)

        return {
            "stored":True,
            "count":len(self.history)
        }


