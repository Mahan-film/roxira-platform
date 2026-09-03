

from src.roxira_manager.repair_engine.code_executor.code_executor import CodeExecutor


executor=CodeExecutor()


patch={

"target":

"output_apps/smart_judge/src/engines/legal_drafter.py",

"operations":[

"CREATE_CLASS SmartJudgeEngine"

]

}


print(

executor.prepare_execution(patch)

)

