

from src.roxira_manager.dev_agent.agent_router.router import AgentRouter



router=AgentRouter()



tests=[

"fix missing analyze method",

"create new finance module",

"review code"

]


for task in tests:

    print(
        router.select(task)
    )

