

from src.roxira_manager.agent_os.registry import AgentRegistry

from src.roxira_manager.agent_os.task_planner import TaskPlanner

from src.roxira_manager.agent_os.permission_engine import PermissionEngine

from src.roxira_manager.agent_os.coordinator import MultiAgentCoordinator



registry=AgentRegistry()


print(
registry.register(
"legal_agent",
[
"reasoning",
"drafting",
"research"
],
"max"
)
)



planner=TaskPlanner()

print(
planner.plan(
"تحلیل پرونده ملکی"
)
)



permission=PermissionEngine()

print(
permission.allowed(
"pro",
"free"
)
)



coordinator=MultiAgentCoordinator()

print(
coordinator.execute(
"تنظیم دادخواست",
"legal_agent"
)
)

