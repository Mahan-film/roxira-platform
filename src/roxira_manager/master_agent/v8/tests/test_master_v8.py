

from src.roxira_manager.master_agent.v8.kernel.task_kernel import TaskKernel
from src.roxira_manager.master_agent.v8.registry.agent_registry import AgentRegistry
from src.roxira_manager.master_agent.v8.planner.autonomous_planner import AutonomousPlanner
from src.roxira_manager.master_agent.v8.monitor.runtime_monitor import RuntimeMonitor



analysis=TaskKernel().analyze(
"build smart judge architecture"
)


print(analysis)


print(
AgentRegistry().get()
)


plan=AutonomousPlanner().build(
analysis
)


print(plan)


print(
RuntimeMonitor().observe(plan)
)

