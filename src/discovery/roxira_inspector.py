from __future__ import annotations

import os
import time
import json
import pathlib
import datetime
from typing import Dict, Any, List

ROOT_DIR = pathlib.Path.cwd()
REPORT_OUTPUT = ROOT_DIR / "SYSTEM_INTELLIGENCE_MAP.json"

def inspect_entire_roxira_ecosystem() -> Dict[str, Any]:
    now_ts = time.time()
    three_days_ago = now_ts - (3 * 86400)
    
    recent_changes: List[Dict[str, str]] = []
    mcp_tools_found: List[str] = []
    registered_agents: List[str] = []
    python_modules: List[str] = []

    for p in ROOT_DIR.rglob("*"):
        if any(ignored in p.parts for ignored in [".git", ".venv", "__pycache__", "node_modules"]):
            continue

        if p.is_file():
            stat = p.stat()
            rel_path = str(p.relative_to(ROOT_DIR))

            # ۱. کشف فایل‌های تغییریافته در ۳ روز اخیر
            if stat.st_mtime >= three_days_ago:
                mod_time = datetime.datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M')
                recent_changes.append({"file": rel_path, "modified": mod_time, "size_kb": f"{stat.st_size / 1024:.1f}"})

            # ۲. کشف ابزارهای MCP و اندپوینت‌ها
            if "mcp" in p.name.lower() or "tenant_tools" in p.name:
                mcp_tools_found.append(rel_path)

            # ۳. کشف ایجنت‌ها
            if "agent" in p.name.lower() or "drafter" in p.name or "harvester" in p.name:
                registered_agents.append(rel_path)

            if p.suffix == ".py":
                python_modules.append(rel_path)

    # خواندن وضعیت تسک‌بورد و حافظه سیستم
    task_board_file = ROOT_DIR / "TASK_BOARD.md"
    task_status = task_board_file.read_text(encoding="utf-8") if task_board_file.is_file() else "No Task Board"

    intelligence_map = {
        "timestamp": datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        "root_directory": str(ROOT_DIR),
        "total_python_modules": len(python_modules),
        "active_mcp_servers_and_tools": mcp_tools_found,
        "registered_autonomous_agents": registered_agents,
        "recently_modified_files_count": len(recent_changes),
        "recent_modifications": recent_changes[:15], # ۱۵ تغییر اخیر
        "active_database_invariants": {
            "postgres_port": 5434,
            "redis_cache_port": 6380,
            "unified_fastapi_port": 8000
        }
    }

    REPORT_OUTPUT.write_text(json.dumps(intelligence_map, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"✅ SYSTEM INTELLIGENCE MAP GENERATED: {REPORT_OUTPUT}")
    print(f"📊 Modules: {len(python_modules)} | MCP Tools: {len(mcp_tools_found)} | Agents: {len(registered_agents)}")
    return intelligence_map

if __name__ == "__main__":
    inspect_entire_roxira_ecosystem()
