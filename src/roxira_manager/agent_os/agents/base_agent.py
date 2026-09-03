
class BaseAgent:


    name="base"


    capabilities=[]


    def execute(self,task,context=None):

        return {

            "agent":self.name,

            "task":task,

            "status":"COMPLETED"

        }

