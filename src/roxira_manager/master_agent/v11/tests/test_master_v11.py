

from src.roxira_manager.master_agent.v11.brain.agent_brain import AgentBrain
from src.roxira_manager.master_agent.v11.planner.resource_allocator import ResourceAllocator
from src.roxira_manager.master_agent.v11.executor.autonomous_executor import AutonomousExecutor



brain=AgentBrain().think(
"finish smart judge",
"legal intelligence"
)


print(brain)



resources=ResourceAllocator().allocate(
brain
)


print(resources)



print(
AutonomousExecutor().run(
resources
)
)

