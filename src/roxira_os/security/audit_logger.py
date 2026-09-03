

from datetime import datetime



class AuditLogger:


    def __init__(self):

        self.logs=[]



    def record(
        self,
        user,
        action,
        resource
    ):


        self.logs.append({

            "user":user,

            "action":action,

            "resource":resource,

            "time":str(datetime.utcnow())

        })


    def history(self):

        return self.logs

