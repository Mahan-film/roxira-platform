

from datetime import datetime



class MetricsCollector:


    def __init__(self):

        self.metrics=[]



    def record(
        self,
        service,
        action
    ):


        self.metrics.append({

            "service":service,

            "action":action,

            "time":str(datetime.utcnow())

        })


    def get_all(self):

        return self.metrics

