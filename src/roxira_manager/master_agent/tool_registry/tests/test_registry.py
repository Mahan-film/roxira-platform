

from src.roxira_manager.master_agent.tool_registry.registry import ToolRegistry


r=ToolRegistry()


print(
r.select("legal")
)


print(
r.select("general")
)

