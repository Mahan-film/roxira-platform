class ExecutionLogger:


    def __init__(self):

        self.logs=[]



    def record(self,event):

        self.logs.append(event)


        return True
