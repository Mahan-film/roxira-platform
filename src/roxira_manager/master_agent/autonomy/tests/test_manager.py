

from src.roxira_manager.master_agent.autonomy.autonomous_manager import AutonomousManager


manager=AutonomousManager()


print(
manager.execute(
"analyze smart judge case",
"legal"
)
)


print(
manager.execute(
"fix python bug",
"general"
)
)

