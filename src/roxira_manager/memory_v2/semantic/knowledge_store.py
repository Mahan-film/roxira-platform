class KnowledgeStore:


    def __init__(self):

        self.knowledge={}



    def save(self,key,value):

        self.knowledge[key]=value



    def get(self,key):

        return self.knowledge.get(key)
