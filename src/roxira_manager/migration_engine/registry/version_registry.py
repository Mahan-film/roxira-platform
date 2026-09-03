class VersionRegistry:

    def __init__(self):

        self.components={}


    def register(self,name,version):

        self.components[name]=version

        return {
            "registered":True
        }


    def list(self):

        return self.components
