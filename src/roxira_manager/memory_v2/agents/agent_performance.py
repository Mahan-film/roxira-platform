class AgentPerformance:


    def __init__(self):

        self.metrics={}



    def record(self,agent,result):

        self.metrics.setdefault(
            agent,
            []
        ).append(result)
