from dataclasses import dataclass


@dataclass
class ExecutionRequest:

    agent:str
    task:str
    workspace:str="sandbox"
    timeout:int=300
