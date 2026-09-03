

from src.roxira_manager.dev_agent.engineering_agent.intelligence.method_checker import MethodChecker

from src.roxira_manager.dev_agent.engineering_agent.intelligence.import_checker import ImportChecker



methods = MethodChecker().scan()

print(
len(methods["classes"])
)

print(
methods["status"]
)


imports = ImportChecker().scan()

print(
imports
)

