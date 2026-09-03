

from src.roxira_manager.master_agent.v2.planner.task_decomposer import TaskDecomposer
from src.roxira_manager.master_agent.v2.parallel.parallel_executor import ParallelExecutor
from src.roxira_manager.master_agent.v2.context.repository_context import RepositoryContext
from src.roxira_manager.master_agent.v2.memory.evolutionary_memory import EvolutionaryMemory
from src.roxira_manager.master_agent.v2.healing.self_healing_loop import SelfHealingLoop
from src.roxira_manager.master_agent.v2.critic.agent_critic import AgentCritic



plan=TaskDecomposer().decompose(
    "upgrade smart judge",
    "legal"
)


print(plan)


print(
ParallelExecutor().execute(
    plan["steps"]
)
)


print(
RepositoryContext().build()
)


memory=EvolutionaryMemory()

print(
memory.learn(plan)
)


print(
SelfHealingLoop().analyze(
"missing method"
)
)


print(
AgentCritic().review(plan)
)

