class ComponentRegistry:


    def __init__(self):

        self.components={}



    def register(self,name,path):

        self.components[name]=path



    def all(self):

        return self.components
