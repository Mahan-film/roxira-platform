"""
ROXIRA QUANTITATIVE MARKET ANALYSIS & BACKTESTING ENGINE
موتور تحلیل شاخص‌های تکنیکال، پردازش ویژگی‌های مالی و شبیه‌ساز مدیریت ریسک
"""
import math
from typing import List, Dict, Any

class QuantitativeMarketEngine:
    @staticmethod
    def calculate_technical_indicators(prices: List[float]) -> Dict[str, Any]:
        """محاسبه میانگین متحرک ساده (SMA) و شاخص قدرت نسبی (RSI)"""
        if len(prices) < 14:
            return {"error": "حداقل به ۱۴ کندل قیمتی نیاز است."}

        # ۱. محاسبه SMA-14
        period = 14
        recent_prices = prices[-period:]
        sma_14 = sum(recent_prices) / period

        # ۲. محاسبه تقریبی RSI-14
        gains = []
        losses = []
        for i in range(1, len(recent_prices)):
            diff = recent_prices[i] - recent_prices[i-1]
            if diff >= 0:
                gains.append(diff)
                losses.append(0.0)
            else:
                gains.append(0.0)
                losses.append(abs(diff))

        avg_gain = sum(gains) / (period - 1) if gains else 0.0001
        avg_loss = sum(losses) / (period - 1) if losses else 0.0001
        
        rs = avg_gain / avg_loss if avg_loss != 0 else 1.0
        rsi_14 = round(100 - (100 / (1 + rs)), 2)

        # ۳. تولید سیگنال آماری بر مبنای شاخص‌ها
        signal = "NEUTRAL"
        if rsi_14 < 30 and recent_prices[-1] > sma_14:
            signal = "OVERSOLD_POTENTIAL_BUY"
        elif rsi_14 > 70:
            signal = "OVERBOUGHT_POTENTIAL_SELL"

        return {
            "current_price": recent_prices[-1],
            "sma_14": round(sma_14, 2),
            "rsi_14": rsi_14,
            "statistical_signal": signal,
            "risk_controls": {
                "suggested_stop_loss_pct": 2.0,
                "suggested_take_profit_pct": 4.0
            }
        }

if __name__ == "__main__":
    sample_btc_prices = [91000, 91500, 92000, 91800, 92400, 93000, 92800, 93200, 94000, 93800, 94500, 95000, 94800, 95200, 96000]
    res = QuantitativeMarketEngine.calculate_technical_indicators(sample_btc_prices)
    print("=== تست موتور تحلیل کمی بازار ===")
    print(f"قیمت جاری: {res['current_price']} | میانگین ۱۴ روزه: {res['sma_14']} | شاخص RSI: {res['rsi_14']}")
    print(f"سیگنال آماری: {res['statistical_signal']}")
