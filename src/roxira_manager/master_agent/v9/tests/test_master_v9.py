

from src.roxira_manager.master_agent.v9.fusion.agent_fusion import AgentFusion
from src.roxira_manager.master_agent.v9.decision.decision_engine import DecisionEngine
from src.roxira_manager.master_agent.v9.learning.experience_engine import ExperienceEngine



fusion=AgentFusion().combine(
[
"legal_agent",
"reasoning_agent",
"critic_agent",
"coding_agent"
]
)


print(fusion)



decision=DecisionEngine().decide(
"upgrade smart judge",
"high"
)


print(decision)



print(
ExperienceEngine().store(
{
"task":"smart judge",
"result":"success"
}
)
)

