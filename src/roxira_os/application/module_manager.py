

class ModuleManager:


    def __init__(self):

        self.modules={}



    def install(self,module):

        name=module["name"]

        self.modules[name]={
            "module":module,
            "status":"INSTALLED"
        }


        return {
            "module":name,
            "status":"INSTALLED"
        }



    def enable(self,name):

        if name in self.modules:

            self.modules[name]["status"]="ACTIVE"


        return self.modules.get(name)



    def disable(self,name):

        if name in self.modules:

            self.modules[name]["status"]="DISABLED"


        return self.modules.get(name)



    def list(self):

        return self.modules

