

from src.roxira_manager.dev_agent.engineering_agent.intelligence.method_engine.method_usage_scanner import MethodUsageScanner


result = MethodUsageScanner().scan()


print(
result["count"]
)


print(
result["status"]
)


print(
result["usages"][:10]
)

