import pathlib

HANDOVER_FILE = pathlib.Path("/opt/roxira_platform/LATEST_AI_HANDOVER.md")

def get_system_context() -> str:
    if HANDOVER_FILE.exists():
        return HANDOVER_FILE.read_text(encoding="utf-8")
    return "سیستم سازمانی روکسیرا در حال اجراست."

def enforce_agent_prompt(custom_system_prompt: str) -> str:
    ctx = get_system_context()
    return (
        f"=== [GLOBAL SYSTEM STATE & ARCHITECTURAL MANDATE] ===\n"
        f"{ctx}\n"
        f"=== [END OF MANDATE] ===\n\n"
        f"Task Instruction: {custom_system_prompt}"
    )
