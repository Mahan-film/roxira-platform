from __future__ import annotations


class AgentExecutor:

    def execute(self, agent_name: str, task: str):

        return {
            "agent": agent_name,
            "task": task,
            "result": f"{agent_name} executed",
            "status": "COMPLETED"
        }