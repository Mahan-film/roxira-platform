

from src.roxira_manager.dev_agent.agent_ecosystem.registry import AgentRegistry

from src.roxira_manager.dev_agent.capability_router.router import CapabilityRouter

from src.roxira_manager.dev_agent.autonomous_loop.controller import AutonomousDevelopmentController

from src.roxira_manager.dev_agent.external_agents.aider_adapter import AiderAgent

from src.roxira_manager.dev_agent.external_agents.openhands_adapter import OpenHandsAgent

from src.roxira_manager.dev_agent.external_agents.opencode_adapter import OpenCodeAgent



agents={

"aider":
AiderAgent(),

"openhands":
OpenHandsAgent(),

"opencode":
OpenCodeAgent()

}



controller=AutonomousDevelopmentController(

    CapabilityRouter(
        AgentRegistry()
    ),

    agents

)



tests=[

"fix missing analyze method",

"create legal reasoning architecture"

]


for t in tests:

    print(
        controller.execute(t)
    )

