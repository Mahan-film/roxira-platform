class IsolationManager:


    def __init__(self):

        self.active={}



    def lock(self,resource,agent):

        if resource in self.active:

            return False


        self.active[resource]=agent

        return True



    def unlock(self,resource):

        self.active.pop(
            resource,
            None
        )
