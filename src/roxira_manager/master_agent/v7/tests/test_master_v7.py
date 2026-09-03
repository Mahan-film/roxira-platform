

from src.roxira_manager.master_agent.v7.factory.autonomous_factory import AutonomousFactory
from src.roxira_manager.master_agent.v7.queue.task_queue import TaskQueue
from src.roxira_manager.master_agent.v7.verification.autonomous_validator import AutonomousValidator



factory=AutonomousFactory()


plan=factory.create(
"finish smart judge",
"legal"
)


print(plan)



tasks=plan["pipeline"]


execution=TaskQueue().run(
tasks
)


print(execution)



print(
AutonomousValidator().validate(
execution
)
)

