from dataclasses import dataclass
from typing import Dict, Any


@dataclass
class ExecutionRequest:

    agent:str
    task:str
    workspace:str
    risk:str="low"
    metadata:Dict[str,Any]=None
