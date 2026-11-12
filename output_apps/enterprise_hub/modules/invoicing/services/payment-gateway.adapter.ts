import { Injectable, Logger } from '@nestjs/common';

export interface PaymentRequestParams {
  merchantId: string;
  amountRials: bigint;
  orderId: string;
  description: string;
  callbackUrl: string;
  mobile?: string;
}

export interface PaymentRequestResult {
  success: boolean;
  trackId?: string;
  paymentUrl?: string;
  message?: string;
}

export interface PaymentVerifyParams {
  merchantId: string;
  trackId: string;
}

export interface PaymentVerifyResult {
  success: boolean;
  paid: boolean;
  amountRials?: bigint;
  refNumber?: string;
  cardNumber?: string;
  paidAt?: Date;
  message?: string;
}

@Injectable()
export class PaymentGatewayAdapter {
  private readonly logger = new Logger(PaymentGatewayAdapter.name);

  private readonly requestUrl =
    process.env.ZIBAL_REQUEST_URL || 'https://gateway.zibal.ir/v1/request';
  private readonly verifyUrl =
    process.env.ZIBAL_VERIFY_URL || 'https://gateway.zibal.ir/v1/verify';
  private readonly startUrl =
    process.env.ZIBAL_START_URL || 'https://gateway.zibal.ir/start/';
  private readonly requestTimeoutMs = (() => {
    const raw = Number(process.env.PAYMENT_GATEWAY_TIMEOUT_MS || 10000);
    return Number.isFinite(raw) && raw > 0 ? raw : 10000;
  })();

  /**
   * Requests a payment trackId and checkout URL from Zibal.
   */
  async requestPayment(params: PaymentRequestParams): Promise<PaymentRequestResult> {
    try {
      const payload: Record<string, unknown> = {
        merchant: params.merchantId,
        amount: Number(params.amountRials),
        orderId: params.orderId,
        description: params.description,
        callbackUrl: params.callbackUrl,
      };
      if (params.mobile) {
        payload.mobile = params.mobile;
      }

      const response = await fetch(this.requestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });

      if (!response.ok) {
        return {
          success: false,
          message: `Zibal gateway request returned status ${response.status}`,
        };
      }

      const data = (await response.json()) as {
        result?: number;
        trackId?: string | number;
        message?: string;
      };

      if (data.result === 100 && data.trackId) {
        const trackId = String(data.trackId);
        return {
          success: true,
          trackId,
          paymentUrl: `${this.startUrl}${trackId}`,
          message: 'شناسه پرداخت با موفقیت تولید شد.',
        };
      }

      return {
        success: false,
        message: data.message || `خطا در برقراری ارتباط با درگاه (کد ${data.result})`,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to request payment: ${errorMsg}`);
      return { success: false, message: `خطای ارتباط با درگاه: ${errorMsg}` };
    }
  }

  /**
   * Verifies payment server-side against Zibal.
   * Result codes 100 and 201 are authoritative successful payments.
   */
  async verifyPayment(params: PaymentVerifyParams): Promise<PaymentVerifyResult> {
    try {
      const payload = {
        merchant: params.merchantId,
        trackId: params.trackId,
      };

      const response = await fetch(this.verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });

      if (!response.ok) {
        return {
          success: false,
          paid: false,
          message: `Zibal verify returned HTTP status ${response.status}`,
        };
      }

      const data = (await response.json()) as {
        result?: number;
        amount?: number;
        refNumber?: string | number;
        cardNumber?: string;
        paidAt?: string;
        message?: string;
      };

      if (data.result === 100 || data.result === 201) {
        let amountRials: bigint | undefined;
        if (
          data.amount !== undefined &&
          data.amount !== null &&
          /^\d+$/.test(String(data.amount).trim())
        ) {
          const parsed = BigInt(String(data.amount).trim());
          if (parsed > 0n) {
            amountRials = parsed;
          }
        }
        return {
          success: true,
          paid: true,
          amountRials,
          refNumber: data.refNumber ? String(data.refNumber) : undefined,
          cardNumber: data.cardNumber,
          paidAt: data.paidAt ? new Date(data.paidAt) : new Date(),
          message: 'پرداخت با موفقیت تایید شد.',
        };
      }

      return {
        success: true,
        paid: false,
        message: data.message || `تراکنش ناموفق بود (کد ${data.result})`,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to verify payment: ${errorMsg}`);
      return {
        success: false,
        paid: false,
        message: `خطای ارتباط با درگاه: ${errorMsg}`,
      };
    }
  }
}
