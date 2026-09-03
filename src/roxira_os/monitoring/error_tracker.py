

from datetime import datetime



class ErrorTracker:


    def __init__(self):

        self.errors=[]



    def capture(
        self,
        service,
        error
    ):


        self.errors.append({

            "service":service,

            "error":error,

            "time":str(datetime.utcnow())

        })


    def report(self):

        return self.errors

