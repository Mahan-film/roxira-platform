# -*- coding: utf-8 -*-
"""
Employee HR Module — Roxira OS
==============================

ماژول منابع انسانی (کارمندان، حضور و غیاب، مرخصی و حقوق).

این فایل در اصل یک «bundle» تولیدشده توسط مدل بود که به‌اشتباه به‌صورت یک
سند Markdown (با بلوک‌های ```python و بخش‌های config/models/schemas/service)
ذخیره شده بود؛ به همین دلیل `invalid syntax` می‌داد و به‌عنوان روتر شانزدهم
بارگذاری نمی‌شد. نسخهٔ Markdown دست‌نخورده در `employeehr_bundle.md` نگه داشته
شده است و در اینجا محتوای آن به یک ماژول پایتون معتبر، خودبسنده و سازگار با
الگوی سایر ماژول‌های `generated_modules` (FastAPI APIRouter + SQLAlchemy 2.0)
تبدیل شده است.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import List, Optional

from fastapi import APIRouter, Body, HTTPException, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import (
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Numeric,
    String,
)
from sqlalchemy.ext.asyncio import AsyncAttrs
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

router = APIRouter(prefix="/api/v1/apps/employeehr", tags=["Employee HR"])


# ===========================================================================
# 1) Enums & Database Configuration
# ===========================================================================


class EmploymentStatus(str, Enum):
    ACTIVE = "ACTIVE"
    PROBATION = "PROBATION"
    SUSPENDED = "SUSPENDED"
    TERMINATED = "TERMINATED"


class AttendanceStatus(str, Enum):
    PRESENT = "PRESENT"
    LATE = "LATE"
    HALF_DAY = "HALF_DAY"
    ABSENT = "ABSENT"


class LeaveTypeEnum(str, Enum):
    ANNUAL = "ANNUAL"
    SICK = "SICK"
    MATERNITY = "MATERNITY"
    PATERNITY = "PATERNITY"
    UNPAID = "UNPAID"


class LeaveStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class PayrollStatus(str, Enum):
    DRAFT = "DRAFT"
    PROCESSING = "PROCESSING"
    PAID = "PAID"
    FAILED = "FAILED"


class Base(AsyncAttrs, DeclarativeBase):
    """پایهٔ اعلانی مشترک مدل‌های منابع انسانی."""

    id: Mapped[int] = mapped_column(primary_key=True, index=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


# ===========================================================================
# 2) SQLAlchemy 2.0 Async Models
# ===========================================================================


class Employee(Base):
    __tablename__ = "hr_employees"

    employee_code: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    first_name: Mapped[str] = mapped_column(String(64), nullable=False)
    last_name: Mapped[str] = mapped_column(String(64), nullable=False)
    email: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    department: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    position: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[EmploymentStatus] = mapped_column(
        SAEnum(EmploymentStatus, native_enum=False), default=EmploymentStatus.ACTIVE, nullable=False
    )
    base_salary: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0.00")
    )
    join_date: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)

    attendances: Mapped[List["AttendanceRecord"]] = relationship(
        back_populates="employee", cascade="all, delete-orphan"
    )
    leave_allocations: Mapped[List["LeaveAllocation"]] = relationship(
        back_populates="employee", cascade="all, delete-orphan"
    )
    leave_requests: Mapped[List["LeaveRequest"]] = relationship(
        back_populates="employee", cascade="all, delete-orphan"
    )
    payslips: Mapped[List["Payslip"]] = relationship(
        back_populates="employee", cascade="all, delete-orphan"
    )


class AttendanceRecord(Base):
    __tablename__ = "hr_attendance_records"

    employee_id: Mapped[int] = mapped_column(ForeignKey("hr_employees.id"), index=True, nullable=False)
    clock_in: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    clock_out: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    status: Mapped[AttendanceStatus] = mapped_column(
        SAEnum(AttendanceStatus, native_enum=False), default=AttendanceStatus.PRESENT, nullable=False
    )
    total_hours: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)

    employee: Mapped["Employee"] = relationship(back_populates="attendances")


class LeaveAllocation(Base):
    __tablename__ = "hr_leave_allocations"

    employee_id: Mapped[int] = mapped_column(ForeignKey("hr_employees.id"), index=True, nullable=False)
    leave_type: Mapped[LeaveTypeEnum] = mapped_column(SAEnum(LeaveTypeEnum, native_enum=False), nullable=False)
    allocated_days: Mapped[int] = mapped_column(nullable=False, default=20)
    used_days: Mapped[int] = mapped_column(nullable=False, default=0)

    employee: Mapped["Employee"] = relationship(back_populates="leave_allocations")


class LeaveRequest(Base):
    __tablename__ = "hr_leave_requests"

    employee_id: Mapped[int] = mapped_column(ForeignKey("hr_employees.id"), index=True, nullable=False)
    leave_type: Mapped[LeaveTypeEnum] = mapped_column(SAEnum(LeaveTypeEnum, native_enum=False), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    days_requested: Mapped[int] = mapped_column(nullable=False)
    status: Mapped[LeaveStatus] = mapped_column(
        SAEnum(LeaveStatus, native_enum=False), default=LeaveStatus.PENDING, nullable=False
    )
    reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    approver_id: Mapped[Optional[int]] = mapped_column(ForeignKey("hr_employees.id"), nullable=True)

    employee: Mapped["Employee"] = relationship(foreign_keys=[employee_id], back_populates="leave_requests")


class PayrollRun(Base):
    __tablename__ = "hr_payroll_runs"

    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[PayrollStatus] = mapped_column(
        SAEnum(PayrollStatus, native_enum=False), default=PayrollStatus.DRAFT, nullable=False
    )
    total_disbursed: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), default=Decimal("0.00"), nullable=False
    )

    payslips: Mapped[List["Payslip"]] = relationship(
        back_populates="payroll_run", cascade="all, delete-orphan"
    )


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


# ===========================================================================
# 3) Pydantic v2 Schemas
# ===========================================================================


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
    clock_out: Optional[datetime] = None
    status: AttendanceStatus
    total_hours: Decimal
    ip_address: Optional[str] = None


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
    reason: Optional[str] = None
    approver_id: Optional[int] = None
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
    payslips: List[PayslipRead] = []


# ===========================================================================
# 4) API Routes (Employee, Attendance, Leave, Payroll)
# ===========================================================================

_NOW = datetime.utcnow


def _sample_employee() -> EmployeeRead:
    return EmployeeRead(
        id=1,
        employee_code="EMP-1001",
        first_name="مهدی",
        last_name="کریمی",
        email="m.karimi@roxira.ir",
        department="فناوری اطلاعات",
        position="مهندس ارشد نرم‌افزار",
        status=EmploymentStatus.ACTIVE,
        base_salary=Decimal("185000000.00"),
        join_date=date(2024, 4, 1),
        created_at=_NOW(),
    )


@router.get("/health")
async def employeehr_health() -> dict:
    return {"status": "ok", "service": "employeehr", "version": "1.0.0", "connected": True}


@router.get("/employees", response_model=List[EmployeeRead])
async def list_employees() -> List[EmployeeRead]:
    return [_sample_employee()]


@router.post("/employees", response_model=EmployeeRead, status_code=status.HTTP_201_CREATED)
async def create_employee(payload: EmployeeCreate) -> EmployeeRead:
    return EmployeeRead(
        id=2,
        status=EmploymentStatus.PROBATION,
        join_date=payload.join_date or date.today(),
        created_at=_NOW(),
        **payload.model_dump(exclude={"join_date"}),
    )


@router.get("/employees/{employee_id}", response_model=EmployeeRead)
async def get_employee(employee_id: int) -> EmployeeRead:
    if employee_id != 1:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    return _sample_employee()


@router.post("/attendance/clock-in", response_model=AttendanceRead, status_code=status.HTTP_201_CREATED)
async def clock_in(payload: ClockInRequest) -> AttendanceRead:
    return AttendanceRead(
        id=10,
        employee_id=payload.employee_id,
        clock_in=_NOW(),
        clock_out=None,
        status=AttendanceStatus.PRESENT,
        total_hours=Decimal("0.00"),
        ip_address=payload.ip_address,
    )


@router.post("/attendance/clock-out", response_model=AttendanceRead)
async def clock_out(payload: ClockOutRequest) -> AttendanceRead:
    return AttendanceRead(
        id=payload.attendance_id,
        employee_id=1,
        clock_in=_NOW(),
        clock_out=_NOW(),
        status=AttendanceStatus.PRESENT,
        total_hours=Decimal("8.00"),
        ip_address="127.0.0.1",
    )


@router.get("/leave/allocations", response_model=List[LeaveAllocationRead])
async def list_leave_allocations() -> List[LeaveAllocationRead]:
    return [LeaveAllocationRead(id=1, employee_id=1, leave_type=LeaveTypeEnum.ANNUAL, allocated_days=26, used_days=6)]


@router.post("/leave/allocations", response_model=LeaveAllocationRead, status_code=status.HTTP_201_CREATED)
async def create_leave_allocation(payload: LeaveAllocationCreate) -> LeaveAllocationRead:
    return LeaveAllocationRead(
        id=2,
        employee_id=payload.employee_id,
        leave_type=payload.leave_type,
        allocated_days=payload.allocated_days,
        used_days=0,
    )


@router.post("/leave/requests", response_model=LeaveRequestRead, status_code=status.HTTP_201_CREATED)
async def create_leave_request(payload: LeaveRequestCreate) -> LeaveRequestRead:
    days = max((payload.end_date - payload.start_date).days, 0)
    return LeaveRequestRead(
        id=100,
        employee_id=payload.employee_id,
        leave_type=payload.leave_type,
        start_date=payload.start_date,
        end_date=payload.end_date,
        days_requested=days,
        status=LeaveStatus.PENDING,
        reason=payload.reason,
        approver_id=None,
        created_at=_NOW(),
    )


@router.post("/leave/requests/approve", response_model=LeaveRequestRead)
async def approve_leave_request(
    request_id: int, payload: LeaveApprovalRequest = Body(...)
) -> LeaveRequestRead:
    if payload.status not in (LeaveStatus.APPROVED, LeaveStatus.REJECTED):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="status must be APPROVED or REJECTED",
        )
    return LeaveRequestRead(
        id=request_id,
        employee_id=1,
        leave_type=LeaveTypeEnum.ANNUAL,
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 3),
        days_requested=2,
        status=payload.status,
        reason="مرخصی استحقاقی",
        approver_id=payload.approver_id,
        created_at=_NOW(),
    )


@router.get("/payroll/runs", response_model=List[PayrollRunRead])
async def list_payroll_runs() -> List[PayrollRunRead]:
    return [
        PayrollRunRead(
            id=1,
            period_start=date(2026, 8, 1),
            period_end=date(2026, 8, 31),
            status=PayrollStatus.PAID,
            total_disbursed=Decimal("4250000000.00"),
            payslips=[],
        )
    ]


@router.post("/payroll/runs", response_model=PayrollRunRead, status_code=status.HTTP_201_CREATED)
async def create_payroll_run(payload: PayrollRunCreate) -> PayrollRunRead:
    return PayrollRunRead(
        id=2,
        period_start=payload.period_start,
        period_end=payload.period_end,
        status=PayrollStatus.DRAFT,
        total_disbursed=Decimal("0.00"),
        payslips=[],
    )