

from src.roxira_manager.dev_agent.agent_ecosystem.registry import AgentRegistry

from src.roxira_manager.dev_agent.capability_router.router import CapabilityRouter



router=CapabilityRouter(
    AgentRegistry()
)



tests=[

"fix EvidenceWeight analyze method",

"create new legal judgment architecture",

"review code"

]


for task in tests:

    print(
        router.select_agent(task)
    )

