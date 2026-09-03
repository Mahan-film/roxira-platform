
class ExecutionContext:


    def __init__(self, task):

        self.task = task

        self.history=[]

        self.results={}



    def add_result(self,agent,result):

        self.results[agent]=result

        self.history.append(
            {
                "agent":agent,
                "result":result
            }
        )

