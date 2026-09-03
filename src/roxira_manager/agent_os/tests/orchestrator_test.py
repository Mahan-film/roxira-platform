

from src.roxira_manager.agent_os.orchestration.orchestrator import AgentOrchestrator
from src.roxira_manager.agent_os.healing.self_healer import SelfHealingEngine
from src.roxira_manager.agent_os.memory.session_memory import SessionMemory



engine=AgentOrchestrator()


result=engine.run(

"تحلیل پرونده ملکی و تنظیم دادخواست"

)


memory=SessionMemory()

memory.save(result)


health=SelfHealingEngine().analyze(result)



print(result)

print(memory.recall())

print(health)

