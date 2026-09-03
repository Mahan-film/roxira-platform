

from src.roxira_manager.legal_intelligence.autonomous_research.research_planner import LegalResearchPlanner

from src.roxira_manager.legal_intelligence.autonomous_research.knowledge_gap_detector import KnowledgeGapDetector

from src.roxira_manager.legal_intelligence.case_memory.case_memory import CaseMemory

from src.roxira_manager.legal_intelligence.supervisor.legal_supervisor import LegalSupervisor



case="الزام به تنظیم سند رسمی ملک"


plan=LegalResearchPlanner().plan(case)

print(plan)


gap=KnowledgeGapDetector().detect(

    case,

    []

)

print(gap)



memory=CaseMemory()

print(

memory.store(

    case,

    "legal strategy generated"

)

)



print(

LegalSupervisor().execute(case)

)


