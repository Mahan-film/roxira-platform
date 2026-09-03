

class ModuleRegistry:


    def __init__(self):

        self.modules={}



    def register(self,module):

        self.modules[module.name]=module



    def get(self,name):

        return self.modules.get(name)



    def list(self):

        return list(self.modules.keys())

