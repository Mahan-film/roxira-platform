

class SessionMemory:


    def __init__(self):

        self.storage=[]



    def save(self,data):

        self.storage.append(data)


        return {

            "saved":True,

            "items":len(self.storage)

        }



    def recall(self):

        return self.storage

