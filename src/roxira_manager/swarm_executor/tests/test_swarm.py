

from src.roxira_manager.swarm_executor.swarm_executor import SwarmExecutor


missions=[


{
"name":"repair_smartjudge",
"agent":"opencode",
"priority":"HIGH"
},


{
"name":"upgrade_runtime",
"agent":"openhands",
"priority":"HIGH"
},


{
"name":"security_validation",
"agent":"aider",
"priority":"HIGH"
}


]


engine=SwarmExecutor()


print(

engine.execute_swarm(missions)

)

