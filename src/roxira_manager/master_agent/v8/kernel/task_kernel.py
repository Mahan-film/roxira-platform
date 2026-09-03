

class TaskKernel:


    def analyze(self,task):


        if "architecture" in task:

            risk="high"

        elif "fix" in task:

            risk="low"

        else:

            risk="medium"



        return {

            "task":task,

            "risk":risk,

            "status":"ANALYZED"

        }

