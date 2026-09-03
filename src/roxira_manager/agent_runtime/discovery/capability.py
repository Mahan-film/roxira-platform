class CapabilityRegistry:


    def __init__(self):

        self.capabilities={}


    def register(self,agent,capabilities):

        self.capabilities[agent]=capabilities


    def find(self, capability):

        result=[]

        for agent,caps in self.capabilities.items():

            if capability in caps:

                result.append(agent)

        return result
