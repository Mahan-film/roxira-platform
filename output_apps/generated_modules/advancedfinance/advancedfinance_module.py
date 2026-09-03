from datetime import datetime
from typing import List, Optional
from enum import Enum
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import String, Integer, Float, DateTime, ForeignKey, Enum as SQLEnum, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.ext.asyncio import AsyncAttrs

router = APIRouter(prefix="/api/v1/apps/finance", tags=["Enterprise Finance & Accounting"])

class Base(AsyncAttrs, DeclarativeBase):
    pass

class AccountType(str, Enum):
    ASSET = "ASSET"          # دارایی‌ها
    LIABILITY = "LIABILITY"  # بدهی‌ها
    EQUITY = "EQUITY"        # سرمایه و حقوق صاحبان سهام
    REVENUE = "REVENUE"      # درآمدها
    EXPENSE = "EXPENSE"      # هزینه‌ها

class Account(Base):
    __tablename__ = "fin_chart_of_accounts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    account_type: Mapped[AccountType] = mapped_column(SQLEnum(AccountType))
    currency: Mapped[str] = mapped_column(String(3), default="IRR")
    balance: Mapped[float] = mapped_column(Float, default=0.0)

class JournalEntry(Base):
    __tablename__ = "fin_journal_entries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entry_number: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    date: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="POSTED")

class Invoice(Base):
    __tablename__ = "fin_invoices"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    invoice_number: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    customer_id: Mapped[int] = mapped_column(Integer, index=True)
    subtotal: Mapped[float] = mapped_column(Float)
    tax_amount: Mapped[float] = mapped_column(Float, default=0.0)
    total_amount: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(20), default="ISSUED")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

# Pydantic Schemas
class AccountCreate(BaseModel):
    code: str
    name: str
    account_type: AccountType
    currency: str = "IRR"

class AccountRead(AccountCreate):
    id: int
    balance: float
    model_config = ConfigDict(from_attributes=True)

class JournalItemSchema(BaseModel):
    account_code: str
    debit: float = 0.0
    credit: float = 0.0

class JournalEntryCreate(BaseModel):
    entry_number: str
    description: str
    items: List[JournalItemSchema]

@router.get("/accounts", response_model=List[AccountRead])
async def get_chart_of_accounts():
    return [
        AccountRead(id=1, code="1010", name="موجودی نقد و بانک", account_type=AccountType.ASSET, currency="IRR", balance=50000000.0),
        AccountRead(id=2, code="4010", name="درآمد حاصل از خدمات فروش", account_type=AccountType.REVENUE, currency="IRR", balance=120000000.0)
    ]

@router.post("/journal-entries", status_code=status.HTTP_201_CREATED)
async def create_double_entry(payload: JournalEntryCreate):
    total_debit = sum(i.debit for i in payload.items)
    total_credit = sum(i.credit for i in payload.items)
    if abs(total_debit - total_credit) > 0.001:
        raise HTTPException(status_code=400, detail="سند حسابداری تراز نیست (جمع بدهکار باید با جمع بستانکار برابر باشد).")
    return {"status": "POSTED", "entry_number": payload.entry_number, "balanced_amount": total_debit}
