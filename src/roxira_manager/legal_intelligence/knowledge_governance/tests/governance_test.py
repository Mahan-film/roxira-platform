

from src.roxira_manager.legal_intelligence.knowledge_governance.version_manager import KnowledgeVersionManager
from src.roxira_manager.legal_intelligence.knowledge_governance.approval_engine import ApprovalEngine
from src.roxira_manager.legal_intelligence.knowledge_governance.change_tracker import ChangeTracker



document = "ماده 219 قانون مدنی"



version = KnowledgeVersionManager().create_version(
    document
)

print(version)



approval = ApprovalEngine().approve(
    version
)

print(approval)



change = ChangeTracker().compare(
    "نسخه قدیمی",
    "نسخه جدید"
)

print(change)

