class SystemState:


    def __init__(self):

        self.state={}



    def update(self,key,value):

        self.state[key]=value

        return {

            "status":"UPDATED"

        }
