class ExecutionGateway:


    def __init__(self):
        self.history = []


    def execute(self, agent, task):

        event = {
            "agent": agent,
            "task": task,
            "status": "QUEUED"
        }

        self.history.append(event)

        return event
