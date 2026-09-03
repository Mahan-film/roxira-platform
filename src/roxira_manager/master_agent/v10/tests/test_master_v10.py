

from src.roxira_manager.master_agent.v10.mesh.agent_mesh import AgentMesh
from src.roxira_manager.master_agent.v10.planner.meta_planner import MetaPlanner
from src.roxira_manager.master_agent.v10.execution.agent_executor import AgentExecutor



mesh=AgentMesh()


mesh.register(
"legal_research_agent",
"legal"
)


mesh.register(
"coding_agent",
"engineering"
)


topology=mesh.topology()


print(topology)



plan=MetaPlanner().create(
"complete smart judge"
)


print(plan)



print(
AgentExecutor().execute(
plan,
topology
)
)

