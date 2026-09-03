

class ToolRegistry:


    def __init__(self):

        self.tools={

            "code_scan":{
                "type":"engineering",
                "enabled":True
            },

            "legal_search":{
                "type":"legal",
                "enabled":True
            },

            "vector_memory":{
                "type":"knowledge",
                "enabled":True
            },

            "git_guard":{
                "type":"safety",
                "enabled":True
            },

            "test_runner":{
                "type":"validation",
                "enabled":True
            }

        }


    def select(self,domain):


        result=[]


        for name,data in self.tools.items():

            if domain=="legal" and data["type"]=="legal":
                result.append(name)

            elif domain=="engineering" and data["type"]=="engineering":
                result.append(name)

            elif domain=="general":
                result.append(name)


        return {

            "tools":result,

            "status":"TOOLS_SELECTED"

        }

