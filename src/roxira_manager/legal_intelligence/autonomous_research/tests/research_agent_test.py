

from src.roxira_manager.legal_intelligence.autonomous_research.knowledge_gap_detector import KnowledgeGapDetector
from src.roxira_manager.legal_intelligence.autonomous_research.research_planner import ResearchPlanner
from src.roxira_manager.legal_intelligence.autonomous_research.research_executor import ResearchExecutor
from src.roxira_manager.legal_intelligence.autonomous_research.research_validator import ResearchValidator



case="""
الزام به تنظیم سند رسمی ملک
"""



gap = KnowledgeGapDetector().detect(
    case,
    [
        "ماده 219 قانون مدنی"
    ]
)

print(gap)



plan = ResearchPlanner().create_plan(
    gap["missing"]
)

print(plan)



result = ResearchExecutor().execute(
    plan["plan"]
)

print(result)



validation = ResearchValidator().validate(
    result["results"]
)

print(validation)

