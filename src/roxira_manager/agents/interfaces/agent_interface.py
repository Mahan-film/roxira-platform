from abc import ABC, abstractmethod


class AgentInterface(ABC):

    @abstractmethod
    def name(self):
        pass

    @abstractmethod
    def capabilities(self):
        pass

    @abstractmethod
    def execute(self, task):
        pass
