

from src.roxira_manager.repair_engine.patch_apply.patch_apply_engine import PatchApplyEngine



engine=PatchApplyEngine()



result=engine.execute_agent(

"opencode",

"Implement SmartJudgeEngine according to contract",

"output_apps/smart_judge/src/engines/legal_drafter.py"

)


print(result)



print(

engine.get_history()

)

