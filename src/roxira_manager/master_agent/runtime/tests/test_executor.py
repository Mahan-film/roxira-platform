

from src.roxira_manager.master_agent.runtime.agent_executor import AgentExecutor


executor=AgentExecutor()


print(
executor.run(
"fix missing analyze method",
"general"
)
)


print(
executor.run(
"create legal reasoning architecture",
"legal"
)
)

