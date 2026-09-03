class ArchitectureIndex:


    def __init__(self):

        self.items=[]



    def add(self,item):

        self.items.append(item)

        return {

            "status":"INDEXED"

        }
