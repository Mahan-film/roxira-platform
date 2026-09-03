from abc import ABC,abstractmethod


class BaseProvider(ABC):


    name="unknown"


    @abstractmethod
    def run(self,request):

        pass
