import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { toMinor } from '../../accounting/money';
import { TenantScope } from '../../access/services/tenant-scope';
import { InvoiceDirection } from '../enums/invoice-kind.enum';
import { InvoiceStatus } from '../enums/invoice-status.enum';
import { InvoicingRepository } from '../repositories/invoicing.repository';
import { InvoicePaymentLinkRepository } from '../repositories/invoice-payment-link.repository';
import { PaymentGatewayAdapter } from './payment-gateway.adapter';
import {
  maskMerchantId,
  openMerchantId,
  sealMerchantId,
} from '../utils/payment-gateway-crypto.util';
import {
  ConfigurePaymentGatewayDto,
  PaymentGatewayConfigResponseDto,
} from '../dto/configure-payment-gateway.dto';
import {
  CreatePaymentLinkDto,
  PaymentCallbackQueryDto,
  PaymentCallbackResultDto,
  PaymentLinkResponseDto,
} from '../dto/payment-link-response.dto';
import { InvoicingService } from './invoicing.service';

@Injectable()
export class InvoicePaymentLinkService {
  private readonly logger = new Logger(InvoicePaymentLinkService.name);

  constructor(
    private readonly paymentRepo: InvoicePaymentLinkRepository,
    private readonly invoicingRepo: InvoicingRepository,
    private readonly invoicingService: InvoicingService,
    private readonly gatewayAdapter: PaymentGatewayAdapter,
    private readonly tenantScope: TenantScope,
  ) {}

  /**
   * Configures merchant credentials for a tenant, encrypted at rest via AES-256-GCM.
   */
  async configureGateway(
    tenantId: string,
    dto: ConfigurePaymentGatewayDto,
  ): Promise<PaymentGatewayConfigResponseDto> {
    const gateway = dto.gateway || 'zibal';
    const encryptedMerchantId = sealMerchantId(dto.merchantId, tenantId);
    const saved = await this.paymentRepo.saveConfig(tenantId, {
      gateway,
      encryptedMerchantId,
      isActive: true,
    });
    return {
      gateway: saved.gateway,
      maskedMerchantId: maskMerchantId(dto.merchantId),
      isActive: saved.isActive,
      updatedAt: saved.updatedAt,
    };
  }

  /**
   * Retrieves current gateway configuration with masked merchant credentials.
   * Never returns the plain merchant secret.
   */
  async getGatewayConfig(
    tenantId: string,
    gateway = 'zibal',
  ): Promise<PaymentGatewayConfigResponseDto> {
    const config = await this.paymentRepo.findConfig(tenantId, gateway);
    if (!config) {
      throw new NotFoundException('پیکربندی درگاه پرداخت برای این سازمان یافت نشد.');
    }
    const plainMerchant = openMerchantId(config.encryptedMerchantId, tenantId);
    return {
      gateway: config.gateway,
      maskedMerchantId: maskMerchantId(plainMerchant),
      isActive: config.isActive,
      updatedAt: config.updatedAt,
    };
  }

  /**
   * Generates an online payment link for an issued sales invoice.
   */
  async createPaymentLink(
    tenantId: string,
    invoiceId: string,
    dto?: CreatePaymentLinkDto,
    baseUrl?: string,
  ): Promise<PaymentLinkResponseDto> {
    const effectiveBaseUrl = (
      baseUrl ??
      process.env.PAYMENT_GATEWAY_CALLBACK_BASE_URL ??
      process.env.APP_BASE_URL ??
      ''
    )
      .trim()
      .replace(/\/+$/, '');
    if (!effectiveBaseUrl) {
      throw new InternalServerErrorException(
        'آدرس پایه کال‌بک درگاه پرداخت (PAYMENT_GATEWAY_CALLBACK_BASE_URL) پیکربندی نشده است.',
      );
    }

    const invoice = await this.invoicingRepo.findById(tenantId, invoiceId);
    if (!invoice) {
      throw new NotFoundException(`صورتحساب با شناسه ${invoiceId} یافت نشد.`);
    }

    if (invoice.direction !== InvoiceDirection.SALE) {
      throw new BadRequestException('لینک پرداخت آنلاین فقط برای صورتحساب‌های فروش مجاز است.');
    }

    if (invoice.status === InvoiceStatus.PAID) {
      throw new ConflictException('این صورتحساب قبلاً تسویه و پرداخت شده است.');
    }

    if (invoice.status !== InvoiceStatus.ISSUED) {
      throw new ConflictException('لینک پرداخت فقط برای صورتحساب‌های در وضعیت صادرشده (ISSUED) قابل ایجاد است.');
    }

    const existingLinks = await this.paymentRepo.findPaymentLinksByInvoiceId(tenantId, invoiceId);
    const blockingLink = existingLinks.find((l) =>
      ['PENDING', 'VERIFYING', 'PAID_UNSETTLED', 'SETTLING', 'PAID', 'RECONCILIATION_REQUIRED'].includes(
        l.status,
      ),
    );
    if (blockingLink) {
      throw new ConflictException(
        'برای این صورتحساب پیش‌تر لینک پرداخت فعال یا تاییدشده ثبت شده است.',
      );
    }

    const amountMinor = toMinor(invoice.finalPayable);
    if (amountMinor <= 0n) {
      throw new BadRequestException('مبلغ قابل پرداخت فاکتور باید بزرگتر از صفر باشد.');
    }

    const gatewayConfig = await this.paymentRepo.findConfig(tenantId, 'zibal');
    if (!gatewayConfig || !gatewayConfig.isActive) {
      throw new BadRequestException('درگاه پرداخت زیبال برای این سازمان فعال نشده است.');
    }

    const merchantId = openMerchantId(gatewayConfig.encryptedMerchantId, tenantId);
    if (amountMinor % 100n !== 0n) {
      throw new BadRequestException('مبلغ قابل پرداخت فاکتور باید مضرب صحیح ریال باشد.');
    }
    const amountRials = amountMinor / 100n;

    const callbackUrl = `${effectiveBaseUrl}/enterprise-hub/invoicing/payment-links/callback`;
    const description =
      dto?.description || `پرداخت آنلاین فاکتور فروش شماره ${invoice.taxInvoiceNumber || invoice.id}`;

    const requestResult = await this.gatewayAdapter.requestPayment({
      merchantId,
      amountRials,
      orderId: invoice.id,
      description,
      callbackUrl,
      mobile: dto?.mobile,
    });

    if (!requestResult.success || !requestResult.trackId || !requestResult.paymentUrl) {
      throw new BadGatewayException(requestResult.message || 'خطا در دریافت شناسه پرداخت از درگاه زیبال.');
    }

    const paymentLink = await this.paymentRepo.createPaymentLink(tenantId, {
      invoiceId: invoice.id,
      trackId: requestResult.trackId,
      paymentUrl: requestResult.paymentUrl,
      amount: amountMinor,
      status: 'PENDING',
      gateway: gatewayConfig.gateway,
    });

    return {
      paymentLinkId: paymentLink.id,
      invoiceId: invoice.id,
      trackId: paymentLink.trackId,
      paymentUrl: paymentLink.paymentUrl,
      amount: paymentLink.amount.toString(),
      status: paymentLink.status,
      createdAt: paymentLink.createdAt,
    };
  }

  /**
   * Processes the server-side callback verification from payment gateway.
   * Strictly idempotent on both trackId and gateway_ref via atomic claim.
   * On confirmation, marks invoice as PAID and automatically posts receipt voucher via posting rules.
   */
  async handleCallback(params: PaymentCallbackQueryDto): Promise<PaymentCallbackResultDto> {
    if (!params.trackId) {
      throw new BadRequestException('شناسه تراکنش (trackId) الزامی است.');
    }

    // Always resolve tenant through secure trackId lookup, never trust client-supplied tenantId
    const lookup = await this.paymentRepo.lookupTenantByTrackId(params.trackId);
    if (!lookup) {
      throw new NotFoundException('تراکنش پرداخت با این شناسه یافت نشد.');
    }
    const tenantId = lookup.tenantId;

    // Atomically claim the link for verification (prevents concurrent GET + POST race)
    const claimed = await this.paymentRepo.claimPaymentLinkForVerification(
      tenantId,
      params.trackId,
    );

    if (!claimed) {
      const existing = await this.paymentRepo.findPaymentLinkByTrackId(tenantId, params.trackId);
      if (!existing) {
        throw new NotFoundException('شناسه پرداخت یافت نشد.');
      }
      if (existing.status === 'PAID') {
        return {
          success: true,
          paid: true,
          message: 'این پرداخت قبلاً تایید و ثبت شده است.',
        };
      }
      if (existing.status === 'RECONCILIATION_REQUIRED') {
        return {
          success: false,
          paid: false,
          message: 'پرداخت در درگاه تأیید شده اما صورتحساب قابل تسویه نبود و نیازمند مغایرت‌گیری مالی است.',
        };
      }
      if (existing.status === 'PAID_UNSETTLED' || existing.status === 'SETTLING') {
        const unsettled = await this.paymentRepo.claimUnsettledPaymentLink(tenantId, params.trackId);
        if (unsettled) {
          return this.settleVerifiedLink(tenantId, unsettled, {
            gatewayRef: unsettled.gatewayRef || params.trackId,
            cardNumber: unsettled.cardNumber ?? null,
            paidAt: unsettled.paidAt ?? new Date(),
          });
        }
      }
      return {
        success: false,
        paid: false,
        message: 'تراکنش هم‌اکنون در حال استعلام و تایید است.',
      };
    }

    let gatewayVerified = false;
    try {
      const gatewayConfig = await this.paymentRepo.findConfig(tenantId, claimed.gateway);
      if (!gatewayConfig || !gatewayConfig.isActive) {
        await this.paymentRepo.markPaymentLinkStatus(tenantId, claimed.id, 'UNVERIFIED');
        throw new BadRequestException('پیکربندی درگاه پرداخت معتبر یافت نشد.');
      }

      const merchantId = openMerchantId(gatewayConfig.encryptedMerchantId, tenantId);
      const verifyResult = await this.gatewayAdapter.verifyPayment({
        merchantId,
        trackId: params.trackId,
      });

      if (!verifyResult.success) {
        await this.paymentRepo.markPaymentLinkStatus(tenantId, claimed.id, 'UNVERIFIED');
        return {
          success: false,
          paid: false,
          message: verifyResult.message || 'خطا در استعلام وضعیت تراکنش از درگاه پرداخت.',
        };
      }

      if (!verifyResult.paid) {
        await this.paymentRepo.markPaymentLinkStatus(tenantId, claimed.id, 'FAILED');
        return {
          success: false,
          paid: false,
          message: verifyResult.message || 'تراکنش توسط درگاه پرداخت تأیید نشد.',
        };
      }

      // Fail closed: require verified gateway amount to be present and exact
      const expectedRials = BigInt(claimed.amount) / 100n;
      if (
        verifyResult.amountRials === undefined ||
        verifyResult.amountRials === null ||
        BigInt(verifyResult.amountRials) !== expectedRials
      ) {
        await this.paymentRepo.markPaymentLinkStatus(tenantId, claimed.id, 'FAILED');
        return {
          success: false,
          paid: false,
          message: 'مبلغ پرداخت‌شده نامعتبر است یا با مبلغ فاکتور تطابق ندارد.',
        };
      }

      const refNumber = verifyResult.refNumber || params.trackId;
      const existingRef = await this.paymentRepo.findPaymentLinkByGatewayRef(tenantId, refNumber);
      if (
        existingRef &&
        ['PAID', 'PAID_UNSETTLED', 'SETTLING', 'RECONCILIATION_REQUIRED'].includes(existingRef.status) &&
        existingRef.id !== claimed.id
      ) {
        await this.paymentRepo.markPaymentLinkStatus(tenantId, claimed.id, 'FAILED');
        return {
          success: true,
          paid: true,
          message: 'تراکنش با این شماره مرجع بانکی قبلاً ثبت شده است.',
        };
      }

      const gatewayData = {
        gatewayRef: refNumber,
        cardNumber: verifyResult.cardNumber ?? null,
        paidAt: verifyResult.paidAt ?? new Date(),
      };

      // Durable intermediate state: Zibal has verified & accepted payment, but invoice is not settled yet.
      // Never mark PAID before invoicingService.pay succeeds.
      const markedUnsettled = await this.paymentRepo.markPaymentLinkPaidUnsettled(
        tenantId,
        claimed.id,
        gatewayData,
      );

      if (!markedUnsettled) {
        return {
          success: true,
          paid: true,
          message: 'این پرداخت قبلاً تایید و ثبت شده است.',
        };
      }
      gatewayVerified = true;

      return await this.settleVerifiedLink(tenantId, claimed, gatewayData);
    } catch (err: unknown) {
      const code = (err as { code?: string; driverError?: { code?: string } })?.code ??
        (err as { driverError?: { code?: string } })?.driverError?.code;
      if (code === '23505') {
        await this.paymentRepo.markPaymentLinkStatus(tenantId, claimed.id, 'FAILED').catch(() => undefined);
        return {
          success: true,
          paid: true,
          message: 'تراکنش با این شماره مرجع بانکی قبلاً ثبت شده است.',
        };
      }
      if (!gatewayVerified) {
        await this.paymentRepo.markPaymentLinkStatus(tenantId, claimed.id, 'UNVERIFIED').catch(() => undefined);
      }
      throw err;
    }
  }

  private async settleVerifiedLink(
    tenantId: string,
    link: { id: string; invoiceId: string; trackId: string },
    gatewayData: { gatewayRef: string; cardNumber: string | null; paidAt: Date },
  ): Promise<PaymentCallbackResultDto> {
    if (!link.invoiceId) {
      throw new InternalServerErrorException('Missing invoiceId on claimed payment link');
    }
    try {
      const invoice = await this.invoicingRepo.findById(tenantId, link.invoiceId);
      if (!invoice || invoice.status !== InvoiceStatus.ISSUED) {
        await this.paymentRepo.markPaymentLinkReconciliationRequired(tenantId, link.id, gatewayData);
        this.logger.error(
          `Gateway payment verified (trackId=${link.trackId}, ref=${gatewayData.gatewayRef}) ` +
            `but invoice ${link.invoiceId} status is ${invoice?.status ?? 'MISSING'}; flagged RECONCILIATION_REQUIRED`,
        );
        return {
          success: false,
          paid: false,
          message:
            'پرداخت در درگاه تأیید شد اما صورتحساب پیش‌تر پرداخت یا ابطال شده است و نیازمند مغایرت‌گیری مالی است.',
        };
      }

      await this.invoicingService.pay(tenantId, link.invoiceId);
      await this.paymentRepo.markPaymentLinkPaid(tenantId, link.id, gatewayData);

      return {
        success: true,
        paid: true,
        message: 'پرداخت با موفقیت تأیید شد و سند دریافت ثبت گردید.',
      };
    } catch (err: unknown) {
      await this.paymentRepo
        .markPaymentLinkStatus(tenantId, link.id, 'PAID_UNSETTLED')
        .catch(() => undefined);
      throw err;
    }
  }
}
