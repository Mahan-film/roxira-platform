from __future__ import annotations

import pathlib
import json


BASE_DIR = pathlib.Path(__file__).resolve().parents[2]


class RoxiraBootstrap:

    def __init__(self):
        self.root = BASE_DIR


    def create_structure(self):

        folders = [

            "src/agents",
            "src/workflows",
            "src/tools",
            "src/memory",
            "src/evaluation",

            "output_apps/smart_judge/src/dynamic_legal",
            "output_apps/smart_judge/src/court_engine",

        ]

        for folder in folders:
            path = self.root / folder
            path.mkdir(
                parents=True,
                exist_ok=True
            )

        return folders


    def generate_manifest(self):

        manifest = {

            "system": "ROXIRA AI Agent Layer",

            "components": [

                "LLM Gateway",
                "Model Router",
                "Agent Runtime",
                "Workflow Engine",
                "Memory Layer",
                "Evaluation Layer"

            ]

        }

        file = self.root / "ROXIRA_AGENT_MANIFEST.json"

        file.write_text(
            json.dumps(
                manifest,
                indent=2,
                ensure_ascii=False
            )
        )


    def run(self):

        print(
            "=== ROXIRA BOOTSTRAP START ==="
        )

        self.create_structure()

        self.generate_manifest()

        print(
            "=== ROXIRA BOOTSTRAP COMPLETE ==="
        )


if __name__ == "__main__":

    RoxiraBootstrap().run()