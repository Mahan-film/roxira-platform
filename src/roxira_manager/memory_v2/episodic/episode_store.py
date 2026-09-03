class EpisodeStore:


    def __init__(self):

        self.items=[]



    def add(self,episode):

        self.items.append(
            episode
        )



    def all(self):

        return self.items
