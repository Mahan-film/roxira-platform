from __future__ import annotations

import json
from pathlib import Path

from src.roxira_manager.orchestrator.task_router import TaskRouter
from src.roxira_manager.agents.agent_registry import AgentRegistry
from src.roxira_manager.llm.model_router import ModelRouter
from src.roxira_manager.executors.agent_executor import AgentExecutor
from src.roxira_manager.evaluators.result_validator import ResultValidator
from src.roxira_manager.memory.agent_memory import AgentMemory


class AgentRuntime:

    def __init__(self):

        self.base = Path(__file__).resolve().parents[2]

        self.registry = AgentRegistry(
            self.base / "AGENT_REGISTRY.json"
        )

        self.router = TaskRouter()
        self.model_router = ModelRouter()

        self.executor = AgentExecutor()
        self.validator = ResultValidator()
        self.memory = AgentMemory()


    def execute(self, task: str, tier="pro"):

        agent = self.router.route(task)

        model = self.model_router.select_model(tier)

        result = self.executor.execute(
            agent,
            task
        )

        valid = self.validator.validate(result)

        record = {
            "task": task,
            "agent": agent,
            "model": model,
            "result": result,
            "validated": valid
        }

        self.memory.store(record)

        return record



if __name__ == "__main__":

    runtime = AgentRuntime()

    output = runtime.execute(
        "تشخیص مرجع صالح برای دعوای قرارداد فروش ملک",
        "pro"
    )

    print(json.dumps(
        output,
        ensure_ascii=False,
        indent=2
    ))