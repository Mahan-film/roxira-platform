# -*- coding: utf-8 -*-

---

### 1. Enums & Database Configuration

```python
# employee_hr/config.py
from datetime import datetime
from enum import StrEnum
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import (
    AsyncAttrs,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

DATABASE_URL = "postgresql+asyncpg://roxira_user:roxira_pass@localhost:5432/roxira_os"

engine = create_async_engine(DATABASE_URL, echo=False, pool_size=20, max_overflow=10)
AsyncSessionFactory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(AsyncAttrs, DeclarativeBase):
    id: Mapped[int] = mapped_column(primary_key=True, index=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionFactory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


class EmploymentStatus(StrEnum):
    ACTIVE = "ACTIVE"
    PROBATION = "PROBATION"
    SUSPENDED = "SUSPENDED"
    TERMINATED = "TERMINATED"


class AttendanceStatus(StrEnum):
    PRESENT = "PRESENT"
    LATE = "LATE"
    HALF_DAY = "HALF_DAY"
    ABSENT = "ABSENT"


class LeaveTypeEnum(StrEnum):
    ANNUAL = "ANNUAL"
    SICK = "SICK"
    MATERNITY = "MATERNITY"
    PATERNITY = "PATERNITY"
    UNPAID = "UNPAID"


class LeaveStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class PayrollStatus(StrEnum):
    DRAFT = "DRAFT"
    PROCESSING = "PROCESSING"
    PAID = "PAID"
    FAILED = "FAILED"
```

---

### 2. SQLAlchemy 2.0 Async Models

```python
# employee_hr/models.py
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional
from sqlalchemy import Date, DateTime, Enum, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .config import (
    AttendanceStatus,
    Base,
    EmploymentStatus,
    LeaveStatus,
    LeaveTypeEnum,
    PayrollStatus,
)


class Employee(Base):
    __tablename__ = "hr_employees"

    employee_code: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    first_name: Mapped[str] = mapped_column(String(64), nullable=False)
    last_name: Mapped[str] = mapped_column(String(64), nullable=False)
    email: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    department: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    position: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[EmploymentStatus] = mapped_column(
        Enum(EmploymentStatus, native_enum=False), default=EmploymentStatus.ACTIVE, nullable=False
    )
    base_salary: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    join_date: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)

    # Relationships
    attendances: Mapped[List["AttendanceRecord"]] = relationship(back_populates="employee", cascade="all, delete-orphan")
    leave_allocations: Mapped[List["LeaveAllocation"]] = relationship(back_populates="employee", cascade="all, delete-orphan")
    leave_requests: Mapped[List["LeaveRequest"]] = relationship(back_populates="employee", cascade="all, delete-orphan")
    payslips: Mapped[List["Payslip"]] = relationship(back_populates="employee", cascade="all, delete-orphan")


class AttendanceRecord(Base):
    __tablename__ = "hr_attendance_records"

    employee_id: Mapped[int] = mapped_column(ForeignKey("hr_employees.id"), index=True, nullable=False)
    clock_in: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    clock_out: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    status: Mapped[AttendanceStatus] = mapped_column(
        Enum(AttendanceStatus, native_enum=False), default=AttendanceStatus.PRESENT, nullable=False
    )
    total_hours: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)

    employee: Mapped["Employee"] = relationship(back_populates="attendances")


class LeaveAllocation(Base):
    __tablename__ = "hr_leave_allocations"

    employee_id: Mapped[int] = mapped_column(ForeignKey("hr_employees.id"), index=True, nullable=False)
    leave_type: Mapped[LeaveTypeEnum] = mapped_column(Enum(LeaveTypeEnum, native_enum=False), nullable=False)
    allocated_days: Mapped[int] = mapped_column(nullable=False, default=20)
    used_days: Mapped[int] = mapped_column(nullable=False, default=0)

    employee: Mapped["Employee"] = relationship(back_populates="leave_allocations")


class LeaveRequest(Base):
    __tablename__ = "hr_leave_requests"

    employee_id: Mapped[int] = mapped_column(ForeignKey("hr_employees.id"), index=True, nullable=False)
    leave_type: Mapped[LeaveTypeEnum] = mapped_column(Enum(LeaveTypeEnum, native_enum=False), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    days_requested: Mapped[int] = mapped_column(nullable=False)
    status: Mapped[LeaveStatus] = mapped_column(
        Enum(LeaveStatus, native_enum=False), default=LeaveStatus.PENDING, nullable=False
    )
    reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    approver_id: Mapped[Optional[int]] = mapped_column(ForeignKey("hr_employees.id"), nullable=True)

    employee: Mapped["Employee"] = relationship(foreign_keys=[employee_id], back_populates="leave_requests")


class PayrollRun(Base):
    __tablename__ = "hr_payroll_runs"

    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[PayrollStatus] = mapped_column(
        Enum(PayrollStatus, native_enum=False), default=PayrollStatus.DRAFT, nullable=False
    )
    total_disbursed: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)

    payslips: Mapped[List["Payslip"]] = relationship(back_populates="payroll_run", cascade="all, delete-orphan")


class Payslip(Base):
    __tablename__ = "hr_payslips"

    payroll_run_id: Mapped[int] = mapped_column(ForeignKey("hr_payroll_runs.id"), index=True, nullable=False)
    employee_id: Mapped[int] = mapped_column(ForeignKey("hr_employees.id"), index=True, nullable=False)
    base_salary: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    allowances: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    deductions: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    net_pay: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    payroll_run: Mapped["PayrollRun"] = relationship(back_populates="payslips")
    employee: Mapped["Employee"] = relationship(back_populates="payslips")
```

---

### 3. Pydantic v2 Schemas

```python
# employee_hr/schemas.py
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from .config import (
    AttendanceStatus,
    EmploymentStatus,
    LeaveStatus,
    LeaveTypeEnum,
    PayrollStatus,
)


class BaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Employee Schemas ---
class EmployeeCreate(BaseModel):
    employee_code: str = Field(..., max_length=32)
    first_name: str = Field(..., max_length=64)
    last_name: str = Field(..., max_length=64)
    email: EmailStr
    department: str = Field(..., max_length=64)
    position: str = Field(..., max_length=64)
    base_salary: Decimal = Field(..., ge=0, decimal_places=2)
    join_date: Optional[date] = None


class EmployeeRead(BaseSchema):
    id: int
    employee_code: str
    first_name: str
    last_name: str
    email: EmailStr
    department: str
    position: str
    status: EmploymentStatus
    base_salary: Decimal
    join_date: date
    created_at: datetime


# --- Attendance Schemas ---
class ClockInRequest(BaseModel):
    employee_id: int
    ip_address: Optional[str] = None


class ClockOutRequest(BaseModel):
    attendance_id: int


class AttendanceRead(BaseSchema):
    id: int
    employee_id: int
    clock_in: datetime
    clock_out: Optional[datetime]
    status: AttendanceStatus
    total_hours: Decimal
    ip_address: Optional[str]


# --- Leave Schemas ---
class LeaveAllocationCreate(BaseModel):
    employee_id: int
    leave_type: LeaveTypeEnum
    allocated_days: int = Field(..., gt=0)


class LeaveAllocationRead(BaseSchema):
    id: int
    employee_id: int
    leave_type: LeaveTypeEnum
    allocated_days: int
    used_days: int


class LeaveRequestCreate(BaseModel):
    employee_id: int
    leave_type: LeaveTypeEnum
    start_date: date
    end_date: date
    reason: Optional[str] = None


class LeaveApprovalRequest(BaseModel):
    approver_id: int
    status: LeaveStatus = Field(..., description="APPROVED or REJECTED")


class LeaveRequestRead(BaseSchema):
    id: int
    employee_id: int
    leave_type: LeaveTypeEnum
    start_date: date
    end_date: date
    days_requested: int
    status: LeaveStatus
    reason: Optional[str]
    approver_id: Optional[int]
    created_at: datetime


# --- Payroll Schemas ---
class PayrollRunCreate(BaseModel):
    period_start: date
    period_end: date


class PayslipRead(BaseSchema):
    id: int
    payroll_run_id: int
    employee_id: int
    base_salary: Decimal
    allowances: Decimal
    deductions: Decimal
    net_pay: Decimal


class PayrollRunRead(BaseSchema):
    id: int
    period_start: date
    period_end: date
    status: PayrollStatus
    total_disbursed: Decimal
    payslips: list[PayslipRead] = []
```

---

### 4. Service Layer

```python
# employee_hr/service.py
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .config import AttendanceStatus, EmploymentStatus, LeaveStatus, PayrollStatus
from .models import AttendanceRecord, Employee, LeaveAllocation, LeaveRequest, PayrollRun, Payslip
from .schemas import EmployeeCreate, LeaveAllocationCreate, LeaveRequestCreate, PayrollRunCreate


class HRService:
    def __init__(self, session: AsyncSession):
        self.session = session

    # --- Employee Methods ---
    async def create_employee(self, data: EmployeeCreate) -> Employee:
        existing = await self.session.execute(
            select(Employee).where((Employee.employee_code == data.employee_code) | (Employee.email == data.email))
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Employee with this code or email already exists",
            )

        employee = Employee(**data.model_dump())
        self.session.add(employee)
        await self.session.flush()
        return employee

    async def get_employee(self, employee_id: int) -> Employee:
        emp = await self.session.get(Employee, employee_id)
        if not emp:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
        return emp

    # --- Attendance Tracking ---
    async def clock_in(self, employee_id: int, ip_address: Optional[str] = None) -> AttendanceRecord:
        await self.get_employee(employee_id)
        
        # Check active session
        stmt = select(AttendanceRecord).where(
            AttendanceRecord.employee_id == employee_id,
            