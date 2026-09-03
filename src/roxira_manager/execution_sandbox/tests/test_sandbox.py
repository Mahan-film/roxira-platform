

from src.roxira_manager.execution_sandbox.runner.sandbox import Sandbox
from src.roxira_manager.execution_sandbox.runner.command_runner import CommandRunner
from src.roxira_manager.execution_sandbox.feedback.result_analyzer import ResultAnalyzer



task="upgrade smart judge"



print(
Sandbox().prepare(task)
)



result=CommandRunner().run(
"pytest smart_judge"
)


print(result)



print(
ResultAnalyzer().analyze(result)
)

