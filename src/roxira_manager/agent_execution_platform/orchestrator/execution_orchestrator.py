class ExecutionOrchestrator:


    def __init__(self):

        self.history=[]


    def execute(self,request):


        event={

            "agent":request.agent,

            "task":request.task

        }


        self.history.append(event)


        return {

            "status":"ORCHESTRATED",

            "event":event

        }
