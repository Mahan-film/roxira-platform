
from src.roxira_manager.master_agent.orchestrator import RoxiraMasterAgent


agent = RoxiraMasterAgent()


print(
agent.execute_task(
"fix missing legal method",
"general"
)
)


print(
agent.execute_task(
"create legal reasoning module",
"legal"
)
)

