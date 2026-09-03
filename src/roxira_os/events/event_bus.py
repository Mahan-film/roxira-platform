

class EventBus:


    def __init__(self):

        self.handlers={}



    def subscribe(
        self,
        event_name,
        handler
    ):


        if event_name not in self.handlers:

            self.handlers[event_name]=[]


        self.handlers[event_name].append(
            handler
        )



    def publish(
        self,
        event
    ):


        results=[]


        for handler in self.handlers.get(
            event.name,
            []
        ):

            results.append(
                handler(
                    event.payload
                )
            )


        return results



