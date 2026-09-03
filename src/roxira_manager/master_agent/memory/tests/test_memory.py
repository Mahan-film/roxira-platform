

from src.roxira_manager.master_agent.memory.long_term_memory import LongTermMemory


m=LongTermMemory()


print(
m.save(
{
"task":"smart judge development",
"result":"orchestration ready"
}
)
)


print(
m.load()
)

