from __future__ import annotations


class AgentMemory:

    def __init__(self):
        self.history = []


    def store(self, item):

        self.history.append(item)


    def get_all(self):

        return self.history