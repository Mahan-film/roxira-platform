

from src.roxira_manager.control_plane.agents.real_agent_controller import RealAgentController
from src.roxira_manager.control_plane.contracts.agent_contract import AgentContract



result=RealAgentController().execute(

"opencode",

"analyze smart judge architecture"

)


print(result)



print(

AgentContract().validate(

"opencode",

result

)

)

