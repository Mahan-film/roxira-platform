class EventPublisher:


    def publish(self,name,data):

        return {

            "event":name,

            "payload":data,

            "status":"CREATED"

        }
