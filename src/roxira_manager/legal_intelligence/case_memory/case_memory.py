

class CaseMemory:


    def __init__(self):

        self.memory=[]


    def store(self,case,result):

        item={

            "case":case,

            "result":result

        }

        self.memory.append(item)


        return {

            "stored":True,

            "count":len(self.memory)

        }


    def search(self,case):

        return self.memory

