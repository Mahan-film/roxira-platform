from __future__ import annotations


class TaskPlanner:


    def create_plan(self, task):

        return {

            "task": task,

            "steps":[
                "inspect_existing_architecture",
                "generate_changes",
                "run_validation",
                "create_checkpoint"
            ],

            "status":
            "PLANNED"
        }
