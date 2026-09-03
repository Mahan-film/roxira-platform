from abc import ABC, abstractmethod


class AIProvider(ABC):


    @abstractmethod
    def run(self, prompt):
        pass
