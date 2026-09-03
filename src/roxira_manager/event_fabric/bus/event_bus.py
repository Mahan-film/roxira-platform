class EventBus:


    def __init__(self):

        self.events=[]



    def publish(self,event):

        self.events.append(event)

        return {

            "status":"PUBLISHED",

            "event":event.name

        }



    def history(self):

        return self.events
