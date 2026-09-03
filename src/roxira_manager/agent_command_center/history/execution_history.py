class ExecutionHistory:


    def __init__(self):

        self.records=[]


    def add(self,event):

        self.records.append(event)


        return {

            "stored":True

        }
