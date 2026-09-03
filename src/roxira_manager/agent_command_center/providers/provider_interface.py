from abc import ABC, abstractmethod


class AgentProvider(ABC):


    name="unknown"


    @abstractmethod
    def execute(self,task):

        pass
