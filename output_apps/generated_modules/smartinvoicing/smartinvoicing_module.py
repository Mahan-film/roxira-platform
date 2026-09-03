from datetime import datetime
from typing import List
from enum import Enum
from fastapi import APIRouter, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import String, Integer, Float, DateTime, Enum as SQLEnum, Boolean
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.ext.asyncio import AsyncAttrs

router = APIRouter(prefix="/api/v1/apps/smartinvoicing", tags=["Smart E-Invoicing"])

class Base(AsyncAttrs, DeclarativeBase):
    pass

class InvoiceStatus(str, Enum):
    DRAFT = "DRAFT"
    PAID = "PAID"

class ElectronicInvoice(Base):
    __tablename__ = "fin_smart_invoices"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tax_id_code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    buyer_name: Mapped[str] = mapped_column(String(128), index=True)
    subtotal: Mapped[float] = mapped_column(Float)
    tax_amount: Mapped[float] = mapped_column(Float, default=0.0)
    total_amount: Mapped[float] = mapped_column(Float)
    status: Mapped[InvoiceStatus] = mapped_column(SQLEnum(InvoiceStatus), default=InvoiceStatus.DRAFT)
    zugferd_xml_generated: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class InvoiceRead(BaseModel):
    id: int
    tax_id_code: str
    buyer_name: str
    subtotal: float
    tax_amount: float
    total_amount: float
    status: InvoiceStatus
    zugferd_xml_generated: bool
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

@router.get("/invoices", response_model=List[InvoiceRead])
async def list_invoices():
    return [
        InvoiceRead(
            id=1, tax_id_code="TAX-2026-ROX-9901", buyer_name="هلدینگ هوشمند پیشرو",
            subtotal=10000000.0, tax_amount=900000.0, total_amount=10900000.0,
            status=InvoiceStatus.PAID, zugferd_xml_generated=True, created_at=datetime.utcnow()
        )
    ]
