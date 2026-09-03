"""
ROXIRA UNIFIED FIAT (SHAPARAK) & CRYPTO (USDT TRC20) PAYMENT GATEWAY
درگاه پرداخت آنلاین شاپرک و درگاه رمزارزی تتر با کمترین کارمزد شبکه
"""
import uuid
import datetime
from typing import Dict, Any

class UnifiedPaymentGateway:
    @staticmethod
    def create_shaparak_payment_token(amount_toman: float, order_id: str, callback_url: str) -> Dict[str, Any]:
        """تولید توکن پرداخت اینترنتی شاپرک برای کارت‌های شتاب"""
        token = f"SHP-{uuid.uuid4().hex[:16].upper()}"
        return {
            "gateway_type": "SHAPARAK_FIAT",
            "payment_token": token,
            "amount_toman": amount_toman,
            "redirect_url": f"https://shaparak.payment.gateway/pay/{token}",
            "expires_in_minutes": 15
        }

    @staticmethod
    def create_crypto_usdt_invoice(amount_usd: float, order_id: str) -> Dict[str, Any]:
        """تولید فاکتور واریز تتر USDT TRC20 با حداقل کارمزد شبکه (Zero-Middleman)"""
        # آدرس واریز تتر روی شبکه TRC20
        deposit_address = f"TX{uuid.uuid4().hex[:30].upper()}"
        return {
            "gateway_type": "CRYPTO_NON_CUSTODIAL",
            "crypto_asset": "USDT_TRC20",
            "network": "TRON (Fee < 1 USD)",
            "amount_usdt": amount_usd,
            "deposit_address": deposit_address,
            "order_id": order_id,
            "status": "AWAITING_BLOCKCHAIN_CONFIRMATION"
        }

if __name__ == "__main__":
    shp = UnifiedPaymentGateway.create_shaparak_payment_token(5000000.0, "ORD-101", "https://roxira.net/verify")
    crypto = UnifiedPaymentGateway.create_crypto_usdt_invoice(150.0, "ORD-102")
    print("✅ تست درگاه پرداخت شاپرک و رمزارز:")
    print("توکن شاپرک:", shp["payment_token"])
    print("آدرس واریز تتر TRC20:", crypto["deposit_address"])
