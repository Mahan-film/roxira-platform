

class ToolRegistry:


    def __init__(self):

        self.tools={}



    def register(self,name,tool):

        self.tools[name]=tool



    def available(self):

        return list(self.tools.keys())



