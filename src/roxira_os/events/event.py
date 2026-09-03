

from datetime import datetime


class Event:


    def __init__(
        self,
        name,
        payload
    ):

        self.name=name
        self.payload=payload
        self.timestamp=datetime.utcnow()



    def to_dict(self):

        return {

            "event":
            self.name,

            "payload":
            self.payload,

            "timestamp":
            str(self.timestamp)

        }

