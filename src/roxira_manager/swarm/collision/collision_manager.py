class CollisionManager:


    def __init__(self):

        self.locks={}



    def acquire(self,resource):

        if resource in self.locks:

            return False


        self.locks[resource]=True

        return True



    def release(self,resource):

        self.locks.pop(
            resource,
            None
        )
