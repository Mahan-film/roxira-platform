"""
ROXIRA ROLE-BASED ACCESS CONTROL (RBAC) & SUB-USER MANAGEMENT
مدیریت کاربران زیرمجموعه، تخصیص نقش‌ها و کنترل دسترسی‌های سازمانی
"""
from dataclasses import dataclass
from typing import Dict, List, Any, Optional

class RBACRole:
    TENANT_ADMIN = "ADMIN"
    ACCOUNTANT = "ACCOUNTANT"
    WAREHOUSE_KEEPER = "WAREHOUSE"
    SALES_AGENT = "SALES"
    LEGAL_ADVISOR = "LEGAL"

ROLE_PERMISSIONS = {
    RBACRole.TENANT_ADMIN: ["ALL_ACCESS"],
    RBACRole.ACCOUNTANT: ["LEDGER_WRITE", "REPORTS_READ", "MOADIAN_SIGN", "BANK_RECONCILE"],
    RBACRole.WAREHOUSE_KEEPER: ["INVENTORY_READ", "INVENTORY_WRITE", "DISPATCH_CONFIRM"],
    RBACRole.SALES_AGENT: ["CRM_DEALS_WRITE", "INVOICE_CREATE", "CUSTOMER_READ"],
    RBACRole.LEGAL_ADVISOR: ["LEGAL_DRAFT_WRITE", "GRAPHRAG_READ", "CASE_ANALYZE"]
}

class TenantUserManager:
    def __init__(self):
        # نگهداری کاربران در ساختار داده ایزوله
        self.tenant_users: Dict[str, List[Dict[str, Any]]] = {}

    def create_sub_user(self, tenant_id: str, username: str, email: str, role: str, full_name: str) -> Dict[str, Any]:
        """ایجاد کاربر زیرمجموعه با نقش و دسترسی‌های مشخص"""
        if role not in ROLE_PERMISSIONS:
            raise ValueError(f"نقش کاربری {role} نامعتبر است.")
            
        if tenant_id not in self.tenant_users:
            self.tenant_users[tenant_id] = []
            
        user_record = {
            "user_id": f"USR-{len(self.tenant_users[tenant_id]) + 1:03d}",
            "tenant_id": tenant_id,
            "username": username,
            "email": email,
            "full_name": full_name,
            "role": role,
            "permissions": ROLE_PERMISSIONS[role]
        }
        self.tenant_users[tenant_id].append(user_record)
        return user_record

    def check_permission(self, tenant_id: str, username: str, required_permission: str) -> bool:
        """بررسی مجاز بودن کاربر برای انجام عملیات"""
        users = self.tenant_users.get(tenant_id, [])
        user = next((u for u in users if u["username"] == username), None)
        if not user:
            return False
        permissions = user.get("permissions", [])
        return "ALL_ACCESS" in permissions or required_permission in permissions

if __name__ == "__main__":
    manager = TenantUserManager()
    # ۱. ایجاد انباردار
    u1 = manager.create_sub_user("TENANT-01", "reza_wh", "reza@store.ir", RBACRole.WAREHOUSE_KEEPER, "رضا انباردار")
    # ۲. ایجاد حسابدار
    u2 = manager.create_sub_user("TENANT-01", "sara_acc", "sara@store.ir", RBACRole.ACCOUNTANT, "سارا حسابدار")
    
    print("=== تست سیستم دسترسی کاربران (RBAC) ===")
    print(f"کاربر: {u1['username']} | نقش: {u1['role']} | مجوزها: {u1['permissions']}")
    print(f"دسترسی انباردار به ثبت خروج کالا: {manager.check_permission('TENANT-01', 'reza_wh', 'INVENTORY_WRITE')}")
    print(f"دسترسی انباردار به صدور سند مؤدیان: {manager.check_permission('TENANT-01', 'reza_wh', 'MOADIAN_SIGN')}")
