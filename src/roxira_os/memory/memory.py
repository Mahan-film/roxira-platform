

class ROXIRAMemory:


    def __init__(self):

        self.data=[]



    def store(self,item):

        self.data.append(item)



        return {

            "stored":True,

            "count":len(self.data)

        }



    def search(self):

        return self.data

