

from src.roxira_manager.repair_engine.executor.patch_executor import PatchExecutor



executor=PatchExecutor()


print(

executor.checkpoint()

)


result=executor.execute(

"CREATE_ENGINE SmartJudgeEngine"

)


print(result)


print(

executor.validate(result)

)

