

class DomainLoader:


    def __init__(self):

        self.domains={}



    def register(self,name,module):

        self.domains[name]=module



    def load(self,name):

        return self.domains.get(name)

