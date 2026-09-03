"""
ROXIRA ALGORITHMIC CRYPTO TRADING SKELETON WITH STRICT RISK CONTROLS
موتور شبیه‌ساز معاملات خودکار با پارامترهای مدیریت ریسک و حداقل سرمایه
"""
from dataclasses import dataclass
from typing import Dict, List, Any
import datetime

@dataclass
class TradeOrder:
    order_id: str
    symbol: str
    side: str  # BUY / SELL
    amount_usd: float
    entry_price: float
    stop_loss_price: float
    take_profit_price: float
    status: str

class AlgorithmicTraderEngine:
    MIN_ORDER_USD = 5.0  # حداقل اندازه سفارش در اکثر صرافی‌ها
    ESTIMATED_FEE_RATE = 0.001  # کارمزد معاملات ۰.۱ درصد

    def __init__(self, initial_capital_usd: float = 10.0):
        self.balance_usd = initial_capital_usd
        self.trade_history: List[TradeOrder] = []

    def evaluate_and_execute_trade(self, symbol: str, current_price: float, signal: str, allocated_usd: float) -> Dict[str, Any]:
        if allocated_usd < self.MIN_ORDER_USD:
            return {"status": "REJECTED", "reason": f"مبلغ تخصیص‌یافته ({allocated_usd}$) کمتر از حداقل مجاز صرافی ({self.MIN_ORDER_USD}$) است."}

        if allocated_usd > self.balance_usd:
            return {"status": "REJECTED", "reason": "موجودی ناکافی برای اجرای معامله."}

        fee = allocated_usd * self.ESTIMATED_FEE_RATE
        net_trade_amount = allocated_usd - fee

        # تعیین حد ضرر ۲٪ و حد سود ۴٪
        if signal.upper() == "BUY":
            stop_loss = round(current_price * 0.98, 2)
            take_profit = round(current_price * 1.04, 2)
        else:
            stop_loss = round(current_price * 1.02, 2)
            take_profit = round(current_price * 0.96, 2)

        order = TradeOrder(
            order_id=f"TRD-{len(self.trade_history) + 1:04d}",
            symbol=symbol,
            side=signal.upper(),
            amount_usd=net_trade_amount,
            entry_price=current_price,
            stop_loss_price=stop_loss,
            take_profit_price=take_profit,
            status="EXECUTED_IN_SIMULATION"
        )
        self.trade_history.append(order)
        self.balance_usd -= allocated_usd

        return {
            "status": "EXECUTED",
            "order_id": order.order_id,
            "symbol": order.symbol,
            "side": order.side,
            "entry_price": order.entry_price,
            "stop_loss": order.stop_loss_price,
            "take_profit": order.take_profit_price,
            "trading_fee_usd": fee,
            "remaining_balance_usd": self.balance_usd
        }

if __name__ == "__main__":
    bot = AlgorithmicTraderEngine(initial_capital_usd=20.0)
    res = bot.evaluate_and_execute_trade(symbol="BTC/USDT", current_price=95000.0, signal="BUY", allocated_usd=10.0)
    print("=== تست شبیه‌ساز معاملات الگوریتمی ===")
    print(f"سفارش: {res.get('order_id')} | نماد: {res.get('symbol')} | قیمت ورود: {res.get('entry_price')}")
    print(f"حد ضرر: {res.get('stop_loss')} | حد سود: {res.get('take_profit')} | مانده: {res.get('remaining_balance_usd')}$")
