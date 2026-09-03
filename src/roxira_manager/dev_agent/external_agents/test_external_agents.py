

from src.roxira_manager.dev_agent.external_agents.aider_adapter import AiderAgent
from src.roxira_manager.dev_agent.external_agents.openhands_adapter import OpenHandsAgent
from src.roxira_manager.dev_agent.external_agents.opencode_adapter import OpenCodeAgent



agents=[

AiderAgent(),

OpenHandsAgent(),

OpenCodeAgent()

]


for agent in agents:

    print(
        agent.execute(
            "analyze smart judge"
        )
    )

