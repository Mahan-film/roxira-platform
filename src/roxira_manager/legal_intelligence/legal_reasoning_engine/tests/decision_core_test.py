

from src.roxira_manager.legal_intelligence.legal_reasoning_engine.legal_issue_extractor import LegalIssueExtractor
from src.roxira_manager.legal_intelligence.legal_reasoning_engine.legal_strategy_engine import LegalStrategyEngine
from src.roxira_manager.legal_intelligence.legal_reasoning_engine.legal_risk_engine import LegalRiskEngine

from src.roxira_manager.legal_intelligence.legal_reasoning_engine.core.decision_pipeline import DecisionPipeline



case="""
خریدار ملک هستم
مبایعه نامه عادی دارم
فروشنده حاضر به تنظیم سند رسمی نیست
"""


issues = LegalIssueExtractor().extract(case)

strategy = LegalStrategyEngine().generate(
    issues["issues"]
)

risks = LegalRiskEngine().analyze(case)


result = DecisionPipeline().run(
    case,
    issues,
    strategy,
    risks
)


print(result)

