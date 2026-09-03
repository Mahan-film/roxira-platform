class SystemOrchestrator:


    def __init__(self):

        self.components={}



    def register(self,name,component):

        self.components[name]=component



    def dispatch(self,event):

        return {

            "event":event,

            "status":"DISPATCHED"

        }
