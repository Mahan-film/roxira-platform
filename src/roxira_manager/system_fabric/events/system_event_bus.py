class SystemEventBus:


    def __init__(self):

        self.events=[]



    def publish(self,event):

        self.events.append(event)



    def history(self):

        return self.events
