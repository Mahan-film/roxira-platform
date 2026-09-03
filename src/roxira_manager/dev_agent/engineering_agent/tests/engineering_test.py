

from src.roxira_manager.dev_agent.engineering_agent.scanner import ProjectScanner
from src.roxira_manager.dev_agent.engineering_agent.dependency_checker import DependencyChecker
from src.roxira_manager.dev_agent.engineering_agent.test_runner import TestRunner
from src.roxira_manager.dev_agent.engineering_agent.bug_detector import BugDetector
from src.roxira_manager.dev_agent.engineering_agent.patch_planner import PatchPlanner



scan = ProjectScanner().scan()

print(scan)


deps = DependencyChecker().check(
    scan["files"]
)

print(deps)



test = {
    "status":"FAILED",
    "errors":"missing method analyze"
}



bug = BugDetector().analyze(test)

print(bug)



patch = PatchPlanner().create(
    bug
)

print(patch)

