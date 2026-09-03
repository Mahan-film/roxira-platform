

from src.roxira_manager.legal_intelligence.legal_reasoning_engine.legal_issue_extractor import LegalIssueExtractor

from src.roxira_manager.legal_intelligence.legal_reasoning_engine.legal_strategy_engine import LegalStrategyEngine

from src.roxira_manager.legal_intelligence.legal_reasoning_engine.legal_risk_engine import LegalRiskEngine



case="""
خریدار ملک هستم
مبایعه نامه عادی دارم
فروشنده حاضر به تنظیم سند رسمی نیست
"""


issues = LegalIssueExtractor().extract(case)

print(issues)



print(

LegalStrategyEngine().generate(

issues["issues"]

)

)



print(

LegalRiskEngine().analyze(case)

)

