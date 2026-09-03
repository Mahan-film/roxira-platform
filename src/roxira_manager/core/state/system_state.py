class SystemState:


    def __init__(self):

        self.status = "INITIALIZED"
        self.components = {}


    def register(self,name,status):

        self.components[name]=status


    def snapshot(self):

        return {

            "status":self.status,
            "components":self.components

        }
