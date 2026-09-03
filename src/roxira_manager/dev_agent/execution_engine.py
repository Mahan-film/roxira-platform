from __future__ import annotations

import subprocess
import json
from pathlib import Path


class ExecutionEngine:


    def inspect_project(self):

        root = Path("src")

        return {
            "exists": root.exists(),
            "modules": [
                str(x)
                for x in root.iterdir()
                if x.is_dir()
            ]
        }



    def run_test(self, command):

        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True
        )


        return {
            "return_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr
        }



    def report(self):

        return {
            "engine":
            "ROXIRA_EXECUTION_ENGINE",

            "status":
            "READY"
        }



if __name__ == "__main__":

    engine = ExecutionEngine()

    print(
        json.dumps(
            engine.report(),
            ensure_ascii=False,
            indent=2
        )
    )
