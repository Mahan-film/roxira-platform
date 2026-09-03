

from src.roxira_manager.dev_agent.engineering_agent.intelligence.type_engine.class_registry import ClassRegistry


result=ClassRegistry().scan()


print(
result["count"]
)

print(
result["status"]
)


print(
result["classes"].get(
"EvidenceWeight"
)
)

