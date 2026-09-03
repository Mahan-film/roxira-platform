class RuntimeEngine:


    def __init__(self):

        self.active=[]



    def execute(self,agent,task):

        self.active.append(agent)

        return {

            "agent":agent,

            "task":task,

            "status":"EXECUTED"

        }
