

class ModuleLoader:


    def __init__(self):

        self.modules={}



    def register(self,module):

        self.modules[module.name]=module



    def load(self,name):

        return self.modules.get(name)



    def available_modules(self):

        return list(self.modules.keys())

