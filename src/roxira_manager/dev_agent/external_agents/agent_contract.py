

from abc import ABC, abstractmethod


class ExternalAgent(ABC):


    @abstractmethod
    def name(self):
        pass


    @abstractmethod
    def execute(self, task):
        pass

