
from src.roxira_manager.dev_agent.execution_engine import ExecutionEngine
from src.roxira_manager.dev_agent.planner import TaskPlanner


planner = TaskPlanner()

engine = ExecutionEngine()


print(
    planner.create_plan(
        "Build Legal Drafting Engine"
    )
)


print(
    engine.report()
)

