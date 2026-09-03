

from src.roxira_manager.dev_agent.autonomous_controller.controller import AutonomousEngineeringController



engine = AutonomousEngineeringController()


print(
engine.process(
"analysis",
"BUG_FIX"
)
)



print(
engine.process(
"architecture",
"ARCHITECTURE"
)
)

