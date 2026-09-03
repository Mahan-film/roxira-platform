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
                "name": "legal_rag_search",
                "description": "جستجوی ترکیبی در ۱۳۰۵ ماده قانونی و آرای وحدت رویه دیوان عالی کشور",
                "inputSchema": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}, "limit": {"type": "integer", "default": 3}},
                    "required": ["query"]
                }
            },
            {
                "name": "stealth_web_extract",
                "description": "استخراج داده‌های وب از طریق موتور ضد ردیابی Scrapling Camoufox",
                "inputSchema": {
                    "type": "object",
                    "properties": {"target_url": {"type": "string"}},
                    "required": ["target_url"]
                }
            },
            {
                "name": "financial_invoice_parser",
                "description": "تبدیل PDF و اسناد فاکتور به اسناد حسابداری استاندارد دوبل",
                "inputSchema": {
                    "type": "object",
                    "properties": {"file_name": {"type": "string"}},
                    "required": ["file_name"]
                }
            }
        ]
    }
