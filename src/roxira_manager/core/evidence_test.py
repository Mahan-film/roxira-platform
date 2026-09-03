
from src.roxira_manager.legal_engine.evidence.evidence_analyzer import EvidenceAnalyzer


engine=EvidenceAnalyzer()


print(
engine.analyze(
{
"category":"civil",
"description":
"الزام به تنظیم سند رسمی ملک و خسارت قرارداد"
}
)
)

