from typing import Dict


class AgentRegistry:

    def __init__(self):
        self.agents = {}


    def register(self, contract, adapter):

        self.agents[contract.name] = {
            "contract": contract,
            "adapter": adapter
        }


    def get(self, name):

        return self.agents.get(name)


    def list_agents(self):

        return list(self.agents.keys())
