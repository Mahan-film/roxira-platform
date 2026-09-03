

from src.roxira_manager.master_agent.orchestration.orchestrator import MasterOrchestrator


o=MasterOrchestrator()


print(
o.run(
"fix missing analyze method",
"general"
)
)


print(
o.run(
"create legal reasoning architecture",
"legal"
)
)

