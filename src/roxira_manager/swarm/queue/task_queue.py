class TaskQueue:


    def __init__(self):

        self.tasks=[]



    def push(self,task):

        self.tasks.append(task)



    def pop(self):

        if self.tasks:

            return self.tasks.pop(0)

        return None



    def size(self):

        return len(self.tasks)
