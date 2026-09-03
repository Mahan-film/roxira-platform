

from src.roxira_manager.repair_engine.bridge.real_patch_bridge import RealPatchBridge


bridge=RealPatchBridge()


result=bridge.run_agent(

"opencode",

"Analyze SmartJudgeEngine missing implementation and prepare repair"

)


print(result)


