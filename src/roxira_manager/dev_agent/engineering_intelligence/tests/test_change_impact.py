

from src.roxira_manager.dev_agent.engineering_intelligence.change_impact import ChangeImpactAnalyzer



a=ChangeImpactAnalyzer()



print(
a.check_method_change(
"analysis",
"analyze",
[
"src/roxira_manager/legal_intelligence/judgment_simulation/evidence_weight.py"
]
)
)

