from fastapi import APIRouter
from pydantic import BaseModel
from typing import Dict, Any, List

router = APIRouter(prefix="/api/v1/mcp", tags=["Model Context Protocol (MCP Server)"])

@router.get("/tools")
async def list_mcp_tools():
    return {
        "tools": [
            {
                "name": "legal_rag_search",
                "description": "جستجوی چندلایه‌ای در ۳۷۷۰ رکورد قوانین، آرای وحدت رویه، بخشنامه‌ها و نظریات مشورتی ایران",
                "inputSchema": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}, "limit": {"type": "integer", "default": 3}},
                    "required": ["query"]
                }
            },
            {
                "name": "cbi_delay_damages_calculator",
                "description": "محاسبه دقیق خسارت تاخیر تادیه بر مبنای شاخص سالانه تورم بانک مرکزی (ماده ۵۲۲)",
                "inputSchema": {
                    "type": "object",
                    "properties": {"principal_amount_irr": {"type": "number"}, "start_year": {"type": "integer"}, "end_year": {"type": "integer"}},
                    "required": ["principal_amount_irr", "start_year"]
                }
            },
            {
                "name": "court_jurisdiction_classifier",
                "description": "تشخیص مرجع صالح رسیدگی (دادگاه صلح، عمومی حقوقی یا کیفری) بر اساس نصاب مالی",
                "inputSchema": {
                    "type": "object",
                    "properties": {"dispute_type": {"type": "string"}, "claim_amount_irr": {"type": "number"}},
                    "required": ["dispute_type", "claim_amount_irr"]
                }
            },
            {
                "name": "sayad_and_moadian_compliance",
                "description": "اعتبارسنجی دیجیتال چک‌های صیادی و صدور فاکتور الکترونیک سامانه مودیان با کلید مالیاتی",
                "inputSchema": {
                    "type": "object",
                    "properties": {"action": {"type": "string"}, "payload": {"type": "object"}},
                    "required": ["action", "payload"]
                }
            },
            {
                "name": "stealth_web_crawler",
                "description": "استخراج داده‌های وب با ضد ردیابی Scrapling Camoufox",
                "inputSchema": {
                    "type": "object",
                    "properties": {"target_url": {"type": "string"}},
                    "required": ["target_url"]
                }
            }
        ]
    }
