import os, pathlib
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List

router = APIRouter(prefix="/api/v1/system", tags=["System Orchestrator & State"])

class SubsystemState(BaseModel):
    name: str
    status: str
    owner_agent: str
    current_phase: str
    next_action: str

class PlatformAuditResponse(BaseModel):
    platform_name: str
    active_containers: List[str]
    modules_count: int
    vector_collections: List[str]
    subsystems: List[SubsystemState]

@router.get("/status-matrix", response_model=PlatformAuditResponse)
async def get_system_matrix():
    mod_dir = pathlib.Path("/app/output_apps/generated_modules")
    if not mod_dir.exists():
        mod_dir = pathlib.Path("/opt/roxira_platform/output_apps/generated_modules")
    
    modules = [p.name for p in mod_dir.glob("*") if p.is_dir()]
    
    return PlatformAuditResponse(
        platform_name="Roxira OS Unified Autonomous Platform",
        active_containers=["roxira_nginx_prod", "roxira_app_prod", "roxira_postgres_prod", "roxira_redis_prod", "roxira_qdrant_prod"],
        modules_count=len(modules),
        vector_collections=["iran_laws_bge_m3", "judicial_precedents", "software_factory_code_vectors"],
        subsystems=[
            SubsystemState(name="سامانه قاضی هوشمند (Legal Graph RAG)", status="ACTIVE", owner_agent="Legal Reasoning Agent", current_phase="2 Vector Collections + Graph Ready", next_action="Semantic Graph Search Deployment"),
            SubsystemState(name="سیستم مالی و حسابداری دوبل (IFRS)", status="ACTIVE", owner_agent="Financial Agent", current_phase="Accounts, Ledger & Invoicing Active", next_action="ZUGFeRD Tax Sync"),
            SubsystemState(name="زنجیره تأمین و مدیریت مشتریان (ERP & CRM)", status="ACTIVE", owner_agent="Enterprise Coder", current_phase="Warehouse & Leads Mounted", next_action="Automated Stock Movement"),
            SubsystemState(name="هوش وب و کرولینگ مخفی (Scrapling)", status="ACTIVE", owner_agent="Web Agent", current_phase="Camoufox Engine Installed", next_action="Live Multi-Source Ingestion")
        ]
    )
