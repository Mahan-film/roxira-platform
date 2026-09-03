class SwarmState:


    def __init__(self):

        self.jobs={}



    def update(self,id,status):

        self.jobs[id]=status



    def snapshot(self):

        return self.jobs
