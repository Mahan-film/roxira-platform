from __future__ import annotations


from src.roxira_manager.tools.tool_registry import ToolRegistry


registry = ToolRegistry()


tool = registry.get(
    "legal_case_analyzer"
)


result = tool.analyze_case(
    "خریدار ملک درخواست الزام به تنظیم سند رسمی و خسارت تاخیر دارد"
)


print(result)
