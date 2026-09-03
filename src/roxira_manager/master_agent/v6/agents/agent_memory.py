

class AgentMemory:


    def __init__(self):

        self.history=[]


    def remember(self,event):

        self.history.append(event)

        return {

            "stored":True,

            "count":len(self.history),

            "status":"LEARNING"

        }

