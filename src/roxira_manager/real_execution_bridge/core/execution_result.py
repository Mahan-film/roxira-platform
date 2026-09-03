from dataclasses import dataclass


@dataclass
class ExecutionResult:

    agent:str
    status:str
    output:str=""
