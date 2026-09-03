

from src.roxira_manager.dev_agent.orchestrator.dev_orchestrator import DevOrchestrator



engine=DevOrchestrator()



tests=[

"fix missing analyze method",

"create new legal intelligence module",

"review architecture"

]


for t in tests:

    print(
        engine.execute(t)
    )

