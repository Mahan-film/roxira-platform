

class GlobalState:


    def __init__(self):

        self.data={}



    def update(self,key,value):

        self.data[key]=value


        return {

            "key":key,

            "updated":True,

            "status":"STATE_UPDATED"

        }



    def snapshot(self):

        return self.data


