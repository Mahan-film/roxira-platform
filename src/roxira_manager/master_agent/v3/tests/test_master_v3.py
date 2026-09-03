

from src.roxira_manager.master_agent.v3.router.intelligent_router import IntelligentRouter
from src.roxira_manager.master_agent.v3.models.model_selector import ModelSelector
from src.roxira_manager.master_agent.v3.execution.execution_engine import ExecutionEngine
from src.roxira_manager.master_agent.v3.approval.approval_engine import ApprovalEngine
from src.roxira_manager.master_agent.v3.telemetry.performance import PerformanceMonitor



task="upgrade smart judge architecture"


route=IntelligentRouter().select(
task,
"legal",
"high"
)


print(route)


print(
ModelSelector().choose(task)
)


print(
ExecutionEngine().execute(
route["agent"],
task
)
)


print(
ApprovalEngine().check(
route["risk"]
)
)


print(
PerformanceMonitor().measure(
route
)
)

