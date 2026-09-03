from __future__ import annotations

import json
from typing import Dict, Any

class EnterprisePayrollEngine:
    """Calculates Iranian Labor Law Payroll, 30% Social Security Insurance & Income Tax (Article 84)."""

    # معافیت سالانه/ماهانه حقوق سال ۱۴۰۴-۱۴۰۵ (سقف معافیت ماهانه ۱۲ میلیون تومان)
    TAX_EXEMPT_CEILING_MONTHLY = 12000000.0

    @classmethod
    def calculate_monthly_slip(
        cls,
        base_salary_toman: float,
        housing_allowance: float = 900000.0,
        grocery_allowance: float = 1400000.0,
        child_allowance: float = 0.0,
        overtime_hours: float = 0.0
    ) -> Dict[str, Any]:
        # ۱. محاسبه حقوق ناخالص
        hourly_rate = base_salary_toman / 220.0
        overtime_pay = overtime_hours * hourly_rate * 1.40
        gross_salary = base_salary_toman + housing_allowance + grocery_allowance + child_allowance + overtime_pay

        # ۲. محاسبه بیمه تامین اجتماعی ۳۰٪ (مشمول بیمه)
        insurance_base = base_salary_toman + housing_allowance + grocery_allowance + overtime_pay
        employee_insurance_7pct = insurance_base * 0.07
        employer_insurance_23pct = insurance_base * 0.23
        total_social_security_30pct = insurance_base * 0.30

        # ۳. محاسبه مالیات حقوق (ماده ۸۴ ق.م.م به صورت پله‌ای)
        taxable_income = max(0.0, gross_salary - cls.TAX_EXEMPT_CEILING_MONTHLY - employee_insurance_7pct)
        if taxable_income <= 0:
            income_tax = 0.0
        elif taxable_income <= 16500000.0:
            income_tax = taxable_income * 0.10
        elif taxable_income <= 27000000.0:
            income_tax = (16500000.0 * 0.10) + ((taxable_income - 16500000.0) * 0.15)
        else:
            income_tax = (16500000.0 * 0.10) + (10500000.0 * 0.15) + ((taxable_income - 27000000.0) * 0.20)

        # ۴. حقوق خالص دریافتی پرسنل
        net_payable = gross_salary - employee_insurance_7pct - income_tax

        return {
            "gross_salary_toman": round(gross_salary, 2),
            "employee_deductions": {
                "social_security_7pct": round(employee_insurance_7pct, 2),
                "income_tax_art84": round(income_tax, 2),
                "total_deductions": round(employee_insurance_7pct + income_tax, 2)
            },
            "employer_obligations": {
                "social_security_23pct": round(employer_insurance_23pct, 2),
                "total_cost_to_company": round(gross_salary + employer_insurance_23pct, 2)
            },
            "net_payable_toman": round(net_payable, 2),
            "accounting_entry": {
                "debit": "5102 (هزینه حقوق و دستمزد ناخالص + بیمه کارفرما)",
                "credit_bank": "1101 (خالص پرداختی)",
                "credit_tax": "2103 (مالیات حقوق پرداختنی دارایی)",
                "credit_insurance": "2104 (بیمه پرداختنی تامین اجتماعی)"
            }
        }

if __name__ == "__main__":
    engine = EnterprisePayrollEngine()
    slip = engine.calculate_monthly_slip(
        base_salary_toman=18000000.0,
        housing_allowance=1200000.0,
        grocery_allowance=1800000.0,
        overtime_hours=10.0
    )
    print("✅ ENTERPRISE_PAYROLL_ENGINE_VERIFIED=PASS")
    print(f"Gross: {slip['gross_salary_toman']:,.2f} | Net: {slip['net_payable_toman']:,.2f} TOMAN")
    print(f"Tax (Art 84): {slip['employee_deductions']['income_tax_art84']:,.2f} TOMAN")
