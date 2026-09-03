

from src.roxira_manager.repair_engine.transaction.transaction_engine import PatchTransaction


engine=PatchTransaction()


print(engine.create_checkpoint())


print(

engine.execute_agent(

"opencode",

"repair SmartJudgeEngine"

)

)


test=engine.run_validation()

print(test)


print(

engine.commit_decision(test)

)

