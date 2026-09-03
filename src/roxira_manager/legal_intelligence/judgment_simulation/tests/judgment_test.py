

from src.roxira_manager.legal_intelligence.judgment_simulation.claimant_analyzer import ClaimantAnalyzer
from src.roxira_manager.legal_intelligence.judgment_simulation.defense_generator import DefenseGenerator
from src.roxira_manager.legal_intelligence.judgment_simulation.evidence_weight import EvidenceWeight
from src.roxira_manager.legal_intelligence.judgment_simulation.judge_simulator import JudgeSimulator



case="""
خریدار ملک هستم
مبایعه نامه دارم
فروشنده سند نمی زند
"""


claim = ClaimantAnalyzer().analyze(case)

print(claim)



defense = DefenseGenerator().generate(
    claim["claims"]
)

print(defense)



evidence = EvidenceWeight().analysis(
[
"مبایعه نامه",
"رسید پرداخت",
"گواهی عدم حضور"
]
)

print(evidence)



result = JudgeSimulator().simulate(
    claim,
    evidence["evidence_score"],
    defense["defenses"]
)

print(result)

