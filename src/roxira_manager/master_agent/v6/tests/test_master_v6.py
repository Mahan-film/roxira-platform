

from src.roxira_manager.master_agent.v6.orchestrator.neural_orchestrator import NeuralOrchestrator
from src.roxira_manager.master_agent.v6.agents.agent_memory import AgentMemory
from src.roxira_manager.master_agent.v6.learning.adaptive_learning import AdaptiveLearning



engine=NeuralOrchestrator()



result=engine.run(
"complete smart judge legal intelligence",
"legal"
)


print(result)



memory=AgentMemory()


print(
memory.remember(result)
)



print(
AdaptiveLearning().improve(
{
"score":100,
"status":"SUCCESS"
}
)
)

