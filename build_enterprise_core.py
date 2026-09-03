import pathlib

base_out = pathlib.Path("/opt/roxira_platform/output_apps/generated_modules")
base_out.mkdir(parents=True, exist_ok=True)

# ۱. سیستم مالی و حسابداری پیشرفته (Advanced Finance & Double-Entry Accounting)
finance_code = '''from datetime import datetime
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
'''

# ۲. انبارداری پیشرفته (Warehouse ERP)
warehouse_code = '''from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import String, Integer, Float, DateTime, ForeignKey
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.ext.asyncio import AsyncAttrs

router = APIRouter(prefix="/api/v1/apps/warehouse", tags=["Warehouse & ERP"])

class Base(AsyncAttrs, DeclarativeBase):
    pass

class Warehouse(Base):
    __tablename__ = "erp_warehouses"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    location_code: Mapped[str] = mapped_column(String(50), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class StockItem(Base):
    __tablename__ = "erp_stock_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sku: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    barcode: Mapped[str] = mapped_column(String(128), index=True)
    name: Mapped[str] = mapped_column(String(255))
    quantity: Mapped[float] = mapped_column(Float, default=0.0)
    batch_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

class StockItemCreate(BaseModel):
    sku: str
    barcode: str
    name: str
    quantity: float
    batch_number: Optional[str] = None

class StockItemRead(StockItemCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)

@router.get("/items", response_model=List[StockItemRead])
async def list_items():
    return [
        StockItemRead(id=1, sku="SKU-ROX-01", barcode="626000123456", name="سرور ابری روکسیرا نود A", quantity=15.0, batch_number="B-2026-09")
    ]

@router.post("/items", response_model=StockItemRead, status_code=status.HTTP_201_CREATED)
async def register_item(payload: StockItemCreate):
    return StockItemRead(id=2, **payload.model_dump())
'''

# ۳. مدیریت ارتباط با مشتری (Atomic CRM)
crm_code = '''from datetime import datetime
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
'''

# ذخیره فایل‌ها در پوشه‌های استاندارد پکیج
modules = {
    "advancedfinance": ("advancedfinance_module.py", finance_code),
    "warehouseinventory": ("warehouseinventory_module.py", warehouse_code),
    "atomiccrm": ("atomiccrm_module.py", crm_code)
}

for folder, (fname, code) in modules.items():
    fdir = base_out / folder
    fdir.mkdir(parents=True, exist_ok=True)
    (fdir / "__init__.py").touch()
    (fdir / fname).write_text(code, encoding="utf-8")
    print(f"✅ ماژول [{folder}] مستقر شد -> {fdir / fname}")

(base_out / "__init__.py").touch()
print("🏁 استقرار فایل‌های ماژول با موفقیت کامل شد.")
