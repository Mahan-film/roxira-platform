class EventRouter:


    def route(self,event):

        return {

            "event":event.name,

            "target":"AUTO",

            "status":"ROUTED"

        }
