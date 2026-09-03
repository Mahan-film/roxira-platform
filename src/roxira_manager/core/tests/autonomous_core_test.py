

from src.roxira_manager.memory.legal_memory import LegalMemory

from src.roxira_manager.knowledge.versioning.legal_version_tracker import LegalVersionTracker

from src.roxira_manager.knowledge.versioning.change_detector import LegalChangeDetector

from src.roxira_manager.runtime.autonomous_controller import AutonomousController



memory=LegalMemory()

print(
memory.store(
{
"case":
"الزام به تنظیم سند رسمی"
}
)
)



tracker=LegalVersionTracker()

print(
tracker.register_rule(
"court_jurisdiction",
"1405.01",
"official_source"
)
)



print(
tracker.check_update(
"court_jurisdiction",
"1406.01"
)
)



detector=LegalChangeDetector()

print(
detector.compare(
"version1",
"version2"
)
)



controller=AutonomousController()

print(
controller.execute(
"پرونده ملک"
)
)


