from dataclasses import dataclass


@dataclass
class RuntimeContext:

    mission:str
    agent:str
    task:str
    metadata:dict
