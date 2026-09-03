

from src.roxira_manager.autonomous_core.planner.task_planner import TaskPlanner
from src.roxira_manager.autonomous_core.router.agent_router import AgentRouter
from src.roxira_manager.autonomous_core.router.model_router import ModelRouter
from src.roxira_manager.autonomous_core.executor.execution_engine import ExecutionEngine
from src.roxira_manager.autonomous_core.validator.validator import Validator
from src.roxira_manager.autonomous_core.memory.memory import AutonomousMemory



task="upgrade smart judge legal reasoning"


plan=TaskPlanner().create(
task,
"legal"
)

print(plan)



agent=AgentRouter().route(
plan["domain"],
"high"
)

print(agent)



model=ModelRouter().select(
"high"
)

print(model)



execution=ExecutionEngine().execute(
agent["agent"],
model,
task
)

print(execution)



validation=Validator().validate(
execution
)

print(validation)



print(
AutonomousMemory().store(
execution
)
)

