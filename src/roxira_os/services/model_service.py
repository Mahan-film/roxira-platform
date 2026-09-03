

class ModelService:


    def __init__(self):

        self.models={}



    def register(self,name,config):

        self.models[name]=config



    def select(self,tier):

        return self.models.get(
            tier,
            self.models.get("free")
        )

