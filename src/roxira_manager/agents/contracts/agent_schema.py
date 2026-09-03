from dataclasses import dataclass
from typing import List


@dataclass
class AgentSchema:

    name: str
    version: str
    capabilities: List[str]
    workspace_scope: str
    permissions: List[str]
