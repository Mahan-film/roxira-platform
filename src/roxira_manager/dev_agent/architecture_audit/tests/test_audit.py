

from src.roxira_manager.dev_agent.architecture_audit.scanner import ModuleScanner

from src.roxira_manager.dev_agent.architecture_audit.duplicate_detector import DuplicateDetector



files=ModuleScanner().scan()


print(
"MODULES:",
len(files)
)


duplicates=DuplicateDetector().scan(
files
)


print(
{
"duplicates":duplicates,
"count":len(duplicates)
}
)

