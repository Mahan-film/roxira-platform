

class EventBus:


    def __init__(self):

        self.events={}



    def subscribe(self,event,handler):

        if event not in self.events:

            self.events[event]=[]

        self.events[event].append(handler)



    def publish(self,event,data):

        results=[]

        for handler in self.events.get(event,[]):

            results.append(handler(data))

        return results

