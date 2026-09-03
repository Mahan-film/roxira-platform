

class MemoryService:


    def __init__(self):

        self.memory=[]



    def store(self,data):

        self.memory.append(data)

        return {
            "stored":True,
            "count":len(self.memory)
        }



    def search(self,query):

        return [
            x for x in self.memory
            if query.lower() in str(x).lower()
        ]

