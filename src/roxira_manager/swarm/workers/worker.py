class SwarmWorker:


    def __init__(self,name,agent):

        self.name=name
        self.agent=agent
        self.status="IDLE"



    def assign(self,task):

        self.status="RUNNING"

        return {

            "worker":self.name,

            "agent":self.agent,

            "task":task,

            "status":self.status

        }
