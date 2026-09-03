

from src.roxira_manager.dev_agent.autonomous_loop.loop import AutonomousLoop


loop = AutonomousLoop()


print(
loop.execute(
"analysis",
"BUG_FIX"
)
)


print(
loop.execute(
"architecture",
"ARCHITECTURE"
)
)

