class ResultStore:


    def __init__(self):

        self.results=[]


    def save(self,result):

        self.results.append(result)

        return True
