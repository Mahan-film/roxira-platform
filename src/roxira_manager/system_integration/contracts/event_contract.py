from dataclasses import dataclass
from datetime import datetime


@dataclass
class SystemEvent:

    name:str
    source:str
    payload:dict
    timestamp:datetime
