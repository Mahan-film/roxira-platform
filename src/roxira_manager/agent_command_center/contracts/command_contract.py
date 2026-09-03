from dataclasses import dataclass
from typing import Dict, Any


@dataclass
class AgentCommand:

    mission:str
    task:str
    priority:str="normal"
    risk:str="low"
    metadata:Dict[str,Any]=None
