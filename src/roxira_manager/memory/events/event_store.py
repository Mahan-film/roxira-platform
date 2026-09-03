class EventStore:


    def __init__(self):

        self.events=[]


    def append(self,event):

        self.events.append(event)


    def all(self):

        return self.events
