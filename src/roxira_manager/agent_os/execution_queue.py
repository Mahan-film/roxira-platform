

class ExecutionQueue:


    def __init__(self):

        self.queue=[]



    def add(self,job):

        self.queue.append(job)



    def next(self):

        if self.queue:

            return self.queue.pop(0)


        return None



