

class MessageQueue:


    def __init__(self):

        self.queue=[]



    def push(self,message):

        self.queue.append(message)



    def consume(self):

        if not self.queue:

            return None


        return self.queue.pop(0)



    def size(self):

        return len(self.queue)

