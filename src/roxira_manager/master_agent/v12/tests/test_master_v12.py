

from src.roxira_manager.master_agent.v12.kernel.agent_os import AgentOS
from src.roxira_manager.master_agent.v12.state.global_state import GlobalState
from src.roxira_manager.master_agent.v12.security.execution_guard import ExecutionGuard



print(
AgentOS().boot()
)



state=GlobalState()


print(
state.update(
"project",
"smart_judge"
)
)


print(
state.snapshot()
)



print(
ExecutionGuard().check(
"architecture_change",
"high"
)
)

