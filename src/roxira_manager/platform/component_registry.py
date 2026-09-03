

class ComponentRegistry:


    def __init__(self):

        self.components={}



    def register(self,name,obj):

        self.components[name]=obj



    def get(self,name):

        return self.components.get(name)



    def list_components(self):

        return list(self.components.keys())

