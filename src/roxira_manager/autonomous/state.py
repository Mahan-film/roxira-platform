
from typing import TypedDict, Any


class AgentState(TypedDict):

    task: str

    selected_agent: str

    plan: list

    result: Any

    validation: Any

    memory_update: Any

    status: str

