from datetime import datetime


class EventLogger:


    def __init__(self):
        self.events=[]


    def log(self,event):

        event["time"]=datetime.utcnow().isoformat()

        self.events.append(event)

        return event


    def get_events(self):

        return self.events
