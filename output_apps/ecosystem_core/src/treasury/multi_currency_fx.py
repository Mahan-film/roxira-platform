"""
ROXIRA MULTI-CURRENCY & MULTI-BRANCH TREASURY ENGINE
سیستم خزانه چندشعبه‌ای صرافی و تسعیر ارزهای بین‌المللی (دلار، درهم، تتر، یورو، روبل)
"""
from dataclasses import dataclass
from typing import Dict, List, Any

@dataclass
class BranchVaultBalance:
    branch_id: str
    currency: str
    amount: float
    fx_rate_to_toman: float

class MultiBranchTreasuryService:
    # نرخ‌های مبنای تسعیر ارز روزانه
    DEFAULT_RATES = {
        "TOMAN": 1.0,
        "USD": 92000.0,
        "USDT": 92000.0,
        "AED": 25050.0,
        "EUR": 99500.0,
        "RUB": 1020.0,
        "SAR": 24500.0,
        "CNY": 12800.0
    }

    def __init__(self):
        # branch_id -> currency -> amount
        self.vaults: Dict[str, Dict[str, float]] = {}

    def deposit_to_branch(self, branch_id: str, currency: str, amount: float):
        curr = currency.upper()
        if branch_id not in self.vaults:
            self.vaults[branch_id] = {}
        self.vaults[branch_id][curr] = self.vaults[branch_id].get(curr, 0.0) + amount

    def get_branch_consolidated_balance(self, branch_id: str) -> Dict[str, Any]:
        """گزارش موجودی تفکیکی و ارزش کل تسعیرشده به تومان"""
        balances = self.vaults.get(branch_id, {})
        total_toman_value = 0.0
        details = []

        for curr, amt in balances.items():
            rate = self.DEFAULT_RATES.get(curr, 1.0)
            toman_val = amt * rate
            total_toman_value += toman_val
            details.append({
                "currency": curr,
                "amount": amt,
                "rate_to_toman": rate,
                "toman_value": toman_val
            })

        return {
            "branch_id": branch_id,
            "total_consolidated_toman": total_toman_value,
            "vault_details": details
        }

if __name__ == "__main__":
    treasury = MultiBranchTreasuryService()
    # واریزی به شعبه دبی صرافی
    treasury.deposit_to_branch("BRANCH-DUBAI", "AED", 50000.0)
    treasury.deposit_to_branch("BRANCH-DUBAI", "USDT", 20000.0)
    res = treasury.get_branch_consolidated_balance("BRANCH-DUBAI")
    print("✅ تست خزانه چندارزی صرافی:")
    print(f"شعبه: {res['branch_id']} | ارزش کل موجودی: {res['total_consolidated_toman']:,.0f} تومان")
    for d in res["vault_details"]:
        print(f"  ├─ {d['amount']:,.0f} {d['currency']} (ارزش: {d['toman_value']:,.0f} تومان)")
