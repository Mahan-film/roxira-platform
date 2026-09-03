class AgentSelector:


    def __init__(self, registry):

        self.registry = registry



    def select(self, capability):


        candidates=[]


        for name in self.registry.list():

            agent=self.registry.get(name)

            if capability in agent.capabilities():

                candidates.append(name)


        return candidates
