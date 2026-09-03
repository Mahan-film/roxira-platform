

class ToolRegistry:


    def __init__(self):

        self.tools={}



    def register(self,name,tool):

        self.tools[name]=tool



    def execute(self,name,*args,**kwargs):

        tool=self.tools.get(name)

        if not tool:

            return {

                "error":"TOOL_NOT_FOUND"

            }


        return tool(*args,**kwargs)

