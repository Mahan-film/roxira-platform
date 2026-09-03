from fastapi import APIRouter
from pydantic import BaseModel
from typing import Dict, Any, List

router = APIRouter(prefix="/api/v1/mcp", tags=["Model Context Protocol (MCP Server)"])

class MCPToolDefinition(BaseModel):
    name: str
    description: str
    inputSchema: Dict[str, Any]

@router.get("/tools")
async def list_mcp_tools():
    return {
        "tools": [
            {
                "name": "smart_judge_corpus_search",
                "description": "جستجوی ترکیبی در مواد قانونی، آرای وحدت رویه، بخشنامه‌ها و نظریات مشورتی قوه قضاییه",
                "inputSchema": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}, "corpus_type": {"type": "string", "default": "all"}},
                    "required": ["query"]
                }
            },
            {
                "name": "financial_double_entry_validator",
                "description": "اعتبارسنجی تراز اسناد دوبل و ثبت در دفتر کل مالی IFRS",
                "inputSchema": {
                    "type": "object",
                    "properties": {"entry_number": {"type": "string"}, "items": {"type": "array"}},
                    "required": ["entry_number", "items"]
                }
            },
            {
                "name": "stealth_web_crawler",
                "description": "خزش و استخراج خودکار داده‌های وب با Scrapling Camoufox",
                "inputSchema": {
                    "type": "object",
                    "properties": {"target_url": {"type": "string"}},
                    "required": ["target_url"]
                }
            }
        ]
    }
