from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, status
from pydantic import BaseModel, ConfigDict, EmailStr
from sqlalchemy import String, Integer, DateTime, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.ext.asyncio import AsyncAttrs

router = APIRouter(prefix="/api/v1/apps/crm", tags=["Atomic CRM"])

class Base(AsyncAttrs, DeclarativeBase):
    pass

class Lead(Base):
    __tablename__ = "crm_leads"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    full_name: Mapped[str] = mapped_column(String(120), index=True)
    email: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    pipeline_stage: Mapped[str] = mapped_column(String(50), default="PROSPECT")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class LeadCreate(BaseModel):
    full_name: str
    email: EmailStr
    pipeline_stage: str = "PROSPECT"
    notes: Optional[str] = None

class LeadRead(LeadCreate):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

@router.get("/leads", response_model=List[LeadRead])
async def get_leads():
    return [
        LeadRead(id=1, full_name="شرکت توسعه فناوری پارس", email="info@parstech.example", pipeline_stage="NEGOTIATION", notes="مذاکره قرارداد ERP", created_at=datetime.utcnow())
    ]

@router.post("/leads", response_model=LeadRead, status_code=status.HTTP_201_CREATED)
async def create_lead(payload: LeadCreate):
    return LeadRead(id=2, created_at=datetime.utcnow(), **payload.model_dump())
