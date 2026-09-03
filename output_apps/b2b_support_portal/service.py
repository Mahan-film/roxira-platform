"""
ROXIRA B2B SMART SUPPORT & TICKET DISPATCHER SERVICE
سامانه مستقل تیکتینگ، اولویت‌بندی با هوش مصنوعی و پشتیبانی سازمانی B2B
"""
import sys
import pathlib
from typing import Dict, List, Any
import datetime

CURRENT_DIR = pathlib.Path.cwd()
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

class B2BSupportTicketService:
    def __init__(self):
        self.tickets: Dict[str, Dict[str, Any]] = {}

    def create_ticket(self, tenant_id: str, client_name: str, subject: str, description: str) -> Dict[str, Any]:
        """ثبت و دسته‌بندی خودکار تیکت پشتیبانی بر مبنای اولویت"""
        priority = "URGENT" if any(w in description.lower() for w in ["قطع", "خطا", "اورژانسی", "باگ", "مالی"]) else "NORMAL"
        ticket_id = f"TCK-{len(self.tickets) + 1:04d}"
        
        ticket_record = {
            "ticket_id": ticket_id,
            "tenant_id": tenant_id,
            "client_name": client_name,
            "subject": subject,
            "description": description,
            "priority": priority,
            "status": "OPEN",
            "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }
        self.tickets[ticket_id] = ticket_record
        return ticket_record

if __name__ == "__main__":
    service = B2BSupportTicketService()
    t = service.create_ticket("TENANT-01", "شرکت فولاد غرب", "خطای صدور فاکتور مودیان", "سامانه مودیان در ارسال فاکتور با خطای توکن مواجه شده است.")
    print("=== تست سامانه تیکتینگ هوشمند B2B ===")
    print(f"شناسه تیکت: {t['ticket_id']} | اولویت تشخیص‌داده‌شده: {t['priority']} | وضعیت: {t['status']}")
