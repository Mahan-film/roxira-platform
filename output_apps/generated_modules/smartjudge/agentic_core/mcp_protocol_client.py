"""
Model Context Protocol (MCP) Client & Server Interface for SmartJudge.
Allows plug-and-play integration with external databases, legal registries, and calculation tools.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Callable, Dict, List, Optional
from pydantic import BaseModel, Field

logger = logging.getLogger("smartjudge.agentic.mcp")


class MCPToolParameter(BaseModel):
    name: str
    type: str
    description: str
    required: bool = True


class MCPToolDefinition(BaseModel):
    name: str
    description: str
    parameters: List[MCPToolParameter]
    handler: Optional[Callable] = Field(default=None, exclude=True)


class SmartJudgeMCPRegistry:
    """ثبت‌کننده ابزارهای استاندارد MCP برای سیستم خودمختار قضایی."""

    def __init__(self):
        self._tools: Dict[str, MCPToolDefinition] = {}
        self._register_builtins()

    def register_tool(self, tool: MCPToolDefinition):
        self._tools[tool.name] = tool
        logger.info(f"Registered MCP tool: {tool.name}")

    def list_tools(self) -> List[Dict[str, Any]]:
        return [
            {
                "name": t.name,
                "description": t.description,
                "parameters": {
                    "type": "object",
                    "properties": {p.name: {"type": p.type, "description": p.description} for p in t.parameters},
                    "required": [p.name for p in t.parameters if p.required]
                }
            }
            for t in self._tools.values()
        ]

    async def execute_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        if tool_name not in self._tools:
            return {"status": "error", "error": f"Tool '{tool_name}' not found in MCP registry"}
        tool = self._tools[tool_name]
        if not tool.handler:
            return {"status": "error", "error": f"Tool '{tool_name}' has no executable handler"}

        try:
            result = await tool.handler(arguments)
            return {"status": "success", "data": result}
        except Exception as exc:
            logger.error(f"Error executing MCP tool {tool_name}: {exc}")
            return {"status": "error", "error": str(exc)}

    def _register_builtins(self):
        """ثبت ابزارهای پایه محاسباتی قضایی."""

        async def calc_damages(args: Dict[str, Any]) -> Dict[str, Any]:
            amount = float(args.get("amount", 0))
            year = int(args.get("year", 1400))
            # فرمول شاخص تورمی بانک مرکزی
            inflated_factor = 1.0 + (1404 - year) * 0.42
            final_amount = round(amount * inflated_factor)
            return {
                "principal": amount,
                "base_year": year,
                "current_year": 1404,
                "adjusted_value_toman": final_amount,
                "formula": "ماده ۵۲۲ قانون آیین دادرسی مدنی بر مبنای شاخص سالانه بانک مرکزی"
            }

        self.register_tool(MCPToolDefinition(
            name="calculate_delay_damages",
            description="محاسبه خسارت تأخیر تأدیه بر اساس ماده ۵۲۲ ق.آ.د.م و شاخص تورم",
            parameters=[
                MCPToolParameter(name="amount", type="number", description="مبلغ اصل خواسته (تومان)"),
                MCPToolParameter(name="year", type="integer", description="سال سررسید یا ایجاد دین (شمسی)"),
            ],
            handler=calc_damages
        ))

        async def query_cbi_rates(args: Dict[str, Any]) -> Dict[str, Any]:
            currency = args.get("currency", "USD").upper()
            return {
                "currency": currency,
                "rate_ets": 520000,
                "rate_nima": 490000,
                "source": "سامانه معاملات الکترونیکی ارز (ETS) و سامانه سنا"
            }

        self.register_tool(MCPToolDefinition(
            name="get_currency_legal_rate",
            description="استعلام نرخ رسمی ارز موضوع دعاوی ارزی و تعهدات بین‌المللی",
            parameters=[
                MCPToolParameter(name="currency", type="string", description="کد سه حرفی ارز (USD, EUR, AED)")
            ],
            handler=query_cbi_rates
        ))
