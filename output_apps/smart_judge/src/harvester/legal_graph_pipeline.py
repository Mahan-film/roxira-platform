from __future__ import annotations

import pathlib
import subprocess
import sys


BASE_DIR = pathlib.Path(__file__).resolve().parent

ROOT_DIR = pathlib.Path(__file__).resolve().parents[4]


SCRIPTS = [
    "mass_corpus_ingestion_swarm.py",
    "bulk_statutes_expander.py",
    "comprehensive_statutes_injector.py",
]


def run_script(script_name: str) -> None:

    script_path = BASE_DIR / script_name

    if not script_path.exists():
        print(f"SKIP: {script_name} not found")
        return

    print(f"\n=== RUNNING {script_name} ===")

    subprocess.run(
        [sys.executable, str(script_path)],
        check=True
    )


def run_validator():

    validator = (
        ROOT_DIR
        / "output_apps"
        / "smart_judge"
        / "src"
        / "graphrag"
        / "graph_validator.py"
    )

    print("\n=== RUNNING graph_validator.py ===")

    subprocess.run(
        [sys.executable, str(validator)],
        check=True
    )


def build_legal_graph():

    print("""
=========================================
 ROXIRA LEGAL GRAPH BUILD PIPELINE
=========================================
""")


    for script in SCRIPTS:
        run_script(script)


    run_validator()


    print("""
=========================================
 LEGAL GRAPH BUILD COMPLETED
=========================================
""")


if __name__ == "__main__":
    build_legal_graph()