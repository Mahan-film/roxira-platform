

class HealthMonitor:


    def __init__(self):

        self.services={}



    def register(
        self,
        name
    ):

        self.services[name]={
            "status":"ACTIVE"
        }



    def check(
        self
    ):

        return {
            "services":self.services,
            "healthy":all(
                x["status"]=="ACTIVE"
                for x in self.services.values()
            )
        }

