

from src.roxira_manager.autonomous_runtime.agents.agent_runtime import AgentRuntime
from src.roxira_manager.autonomous_runtime.tools.tool_runtime import ToolRuntime
from src.roxira_manager.autonomous_runtime.llm.model_runtime import ModelRuntime
from src.roxira_manager.autonomous_runtime.git.git_runtime import GitRuntime



task="upgrade smart judge legal reasoning"



print(
GitRuntime().checkpoint()
)



print(
ToolRuntime().select(task)
)



print(
AgentRuntime().execute(
"openhands",
task
)
)



print(
ModelRuntime().call(
"deepseek-reasoner",
task
)
)



print(
GitRuntime().commit()
)

