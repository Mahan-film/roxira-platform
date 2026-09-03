

from src.roxira_manager.external_gateway.providers.agent_provider import AgentProvider
from src.roxira_manager.external_gateway.security.execution_policy import ExecutionPolicy
from src.roxira_manager.external_gateway.executor.agent_executor import AgentExecutor



agent="openhands"



provider=AgentProvider().get(agent)


print(provider)



print(
ExecutionPolicy().check(
agent,
"ARCHITECTURE"
)
)



print(
AgentExecutor().run(
provider,
"upgrade smart judge architecture"
)
)

