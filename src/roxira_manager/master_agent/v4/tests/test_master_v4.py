

from src.roxira_manager.master_agent.v4.swarm.agent_swarm import AgentSwarm
from src.roxira_manager.master_agent.v4.planner.dynamic_planner import DynamicPlanner
from src.roxira_manager.master_agent.v4.execution.swarm_executor import SwarmExecutor
from src.roxira_manager.master_agent.v4.memory.swarm_memory import SwarmMemory



task="build autonomous smart judge"



swarm=AgentSwarm().spawn(
task,
"legal"
)


print(swarm)



plan=DynamicPlanner().plan(
task,
swarm["agents"]
)


print(plan)



result=SwarmExecutor().run(plan)


print(result)



print(
SwarmMemory().store(result)
)

