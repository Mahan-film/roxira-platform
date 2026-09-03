from dataclasses import dataclass
from datetime import datetime


@dataclass
class Event:

    name:str

    payload:dict

    timestamp:str
