

from src.roxira_manager.repair_engine.autonomous_executor.executor import AutonomousPatchExecutor


engine=AutonomousPatchExecutor()


print(

engine.snapshot(

"output_apps/smart_judge/src/engines/legal_drafter.py"

)

)



print(

engine.apply_agent_patch(

"opencode",

"Implement SmartJudgeEngine class. Modify legal_drafter.py. Do not only explain.",

"output_apps/smart_judge/src/engines/legal_drafter.py"

)

)



print(

engine.validate(

"python -c \"print('validation')\""

)

)

