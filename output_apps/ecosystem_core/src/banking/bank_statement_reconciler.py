"""
ROXIRA INTELLIGENT BANK STATEMENT RECONCILER & AUDIT ENGINE
موتور مغایرت‌گیری بانکی، کشف تراکنش‌های ثبت‌نشده و طرح سوال برای موارد مبهم
"""
import sys
import pathlib
from typing import List, Dict, Any

CURRENT_DIR = pathlib.Path.cwd()
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

class BankStatementReconciler:
    @staticmethod
    def process_statement_transactions(raw_transactions: List[Dict[str, Any]], existing_ledger_descriptions: List[str]) -> Dict[str, Any]:
        matched_entries = []
        auto_detected_routines = []
        ambiguous_queue = []

        for tx in raw_transactions:
            desc = tx.get("description", "").strip()
            amount = float(tx.get("amount", 0.0))
            tx_type = tx.get("type", "CREDIT")  # CREDIT (واریز) یا DEBIT (برداشت)
            tx_id = tx.get("tx_id", "TX-UNKNOWN")

            # ۱. تشخیص خودکار کارمزد بانکی
            if "کارمزد" in desc or "fee" in desc.lower():
                auto_detected_routines.append({
                    "tx_id": tx_id,
                    "account_code": "5301",
                    "account_name": "هزینه کارمزد بانکی",
                    "amount": amount,
                    "description": desc,
                    "action": "AUTO_POST_READY"
                })
            # ۲. تشخیص خودکار سود سپرده بانکی
            elif "سود" in desc or "interest" in desc.lower():
                auto_detected_routines.append({
                    "tx_id": tx_id,
                    "account_code": "4201",
                    "account_name": "درآمد غیرعملیاتی - سود بانکی",
                    "amount": amount,
                    "description": desc,
                    "action": "AUTO_POST_READY"
                })
            # ۳. تطبیق با اسناد ثبت‌شده در سیستم
            elif any(desc in leg or str(int(amount)) in leg for leg in existing_ledger_descriptions):
                matched_entries.append({
                    "tx_id": tx_id,
                    "amount": amount,
                    "status": "ALREADY_RECORDED",
                    "description": desc
                })
            # ۴. شناسایی موارد مبهم (واریزی‌های بدون بابت، فروش دستی، کارت به کارت)
            else:
                ambiguous_queue.append({
                    "tx_id": tx_id,
                    "amount": amount,
                    "type": tx_type,
                    "description": desc,
                    "question_to_user": f"تراکنش {tx_type} به مبلغ {amount:,.0f} تومان با شرح '{desc}' مربوط به کدام مشتری، پروژه یا هزینه است؟",
                    "suggested_accounts": ["1103 (بدهکاران تجاری)", "4101 (فروش کالا)", "5102 (هزینه جاری)"]
                })

        return {
            "total_transactions_analyzed": len(raw_transactions),
            "summary": {
                "matched_count": len(matched_entries),
                "auto_detected_routine_count": len(auto_detected_routines),
                "ambiguous_pending_user_count": len(ambiguous_queue)
            },
            "auto_detected_routines": auto_detected_routines,
            "matched_entries": matched_entries,
            "ambiguous_questions_queue": ambiguous_queue
        }

if __name__ == "__main__":
    reconciler = BankStatementReconciler()
    sample_bank_txs = [
        {"tx_id": "B-101", "amount": 12000.0, "type": "DEBIT", "description": "کارمزد انتقال ساتنا"},
        {"tx_id": "B-102", "amount": 850000.0, "type": "CREDIT", "description": "سود سپرده کوتاه مدت ماهانه"},
        {"tx_id": "B-103", "amount": 15000000.0, "type": "CREDIT", "description": "کارت به کارت از ماهان محمدی"},
        {"tx_id": "B-104", "amount": 4200000.0, "type": "CREDIT", "description": "واریز پوز - فروش فاکتور ۹۰۲۱"}
    ]
    ledger_history = ["فروش فاکتور ۹۰۲۱ به مبلغ ۴۲۰۰۰۰۰"]
    res = reconciler.process_statement_transactions(sample_bank_txs, ledger_history)
    print("=== تست مغایرت‌گیری بانکی و استخراج ابهامات ===")
    print(f"کل تراکنش‌ها: {res['total_transactions_analyzed']}")
    print(f"تطبیق‌یافته: {res['summary']['matched_count']} | روتین خودکار: {res['summary']['auto_detected_routine_count']} | نیازمند استعلام از کاربر: {res['summary']['ambiguous_pending_user_count']}")
    if res['ambiguous_questions_queue']:
        print("نمونه سوال استعلام از کاربر:")
        print("  ❓", res['ambiguous_questions_queue'][0]['question_to_user'])
