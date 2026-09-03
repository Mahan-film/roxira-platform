from dataclasses import dataclass
from typing import List


@dataclass
class AgentContract:

    name: str
    version: str
    capabilities: List[str]
    permissions: List[str]
    workspace_scope: str
