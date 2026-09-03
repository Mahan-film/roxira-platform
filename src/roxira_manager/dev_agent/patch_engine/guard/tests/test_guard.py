

from src.roxira_manager.dev_agent.patch_engine.guard.state_checker import CodeStateChecker

from src.roxira_manager.dev_agent.patch_engine.guard.decision import PatchDecision



file="src/roxira_manager/legal_intelligence/judgment_simulation/evidence_weight.py"


state=CodeStateChecker().check(

file,

"analysis"

)


print(state)


print(

PatchDecision().decide(
state
)

)

