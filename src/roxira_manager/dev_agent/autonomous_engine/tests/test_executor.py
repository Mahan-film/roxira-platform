

from src.roxira_manager.dev_agent.autonomous_engine.executor import AutonomousExecutor



engine=AutonomousExecutor()



print(

engine.validate(

"PYTHONPATH=. python src/roxira_manager/dev_agent/intelligence/method_engine/test_method_engine.py"

)

)

