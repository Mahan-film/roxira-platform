

from src.roxira_manager.repair_engine.extractor.issue_extractor import IssueExtractor
from src.roxira_manager.repair_engine.planner.repair_planner import RepairPlanner



report="""

SmartJudgeEngine missing

GraphRAG broken

AI Gateway not connected

"""



issues=IssueExtractor().extract(report)


print(issues)


print(

RepairPlanner().create(issues)

)

