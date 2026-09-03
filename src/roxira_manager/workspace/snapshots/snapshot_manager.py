class SnapshotManager:


    def __init__(self):

        self.snapshots=[]



    def create(self,item):

        self.snapshots.append(item)

        return item



    def history(self):

        return self.snapshots
