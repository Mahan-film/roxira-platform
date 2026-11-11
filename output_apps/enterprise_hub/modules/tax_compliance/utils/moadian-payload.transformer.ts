import { Currency } from '../../currency/enums/currency.enum';
import { InvoiceResponseDto } from '../../invoicing/dto/invoice-response.dto';
import {
  MoadianBuyerType,
  MoadianInvoicePattern,
  MoadianInvoiceSubject,
  MoadianInvoiceType,
  MoadianSettlementMethod,
} from '../enums/moadian.enum';
import {
  MoadianInvoicePacket,
  MoadianMappingContext,
  mapInvoiceToMoadianPacket,
  MoadianMappingError,
} from './moadian-packet.mapper';

export class MoadianCounterpartyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoadianCounterpartyValidationError';
  }
}

export interface Pattern1SaleLineOptions {
  sstid?: string;
  sstt?: string;
  am?: number;
  mu?: string;
  fee?: number;
  dis?: number;
  vra?: number;
}

export interface Pattern2CurrencyLineOptions {
  sstid?: string;
  sstt?: string;
  cfee: number;
  cut: string;
  exr: number;
  cpr: number;
  sovat: number;
  dis?: number;
  vra?: number;
}

export interface Pattern3GoldLineOptions {
  sstid?: string;
  sstt?: string;
  am?: number;
  fee?: number;
  consfee: number;
  spro: number;
  bros: number;
  cop?: number;
  vop?: number;
  cui?: number;
  dis?: number;
  vra?: number;
}

export interface Pattern4ContractHeaderOptions {
  crn: string;
}

export interface Pattern4ContractLineOptions {
  sstid?: string;
  sstt?: string;
  am?: number;
  fee?: number;
  bsrn?: string;
  dis?: number;
  vra?: number;
}

export interface Pattern7ExportHeaderOptions {
  cdcn?: string;
  cdcd?: number;
  tonw?: number;
  torv?: number;
  tocv?: number;
}

export interface Pattern7ExportLineOptions {
  sstid?: string;
  sstt?: string;
  cut: string;
  exr: number;
  ssrv: number;
  sscv: number;
  nw?: number;
}

/**
 * Validates invoice type (inty: 1 with buyer, 2 without buyer, 3 retail) against
 * counterparty type (tob: 1 natural, 2 legal, 3 civic, 4 foreign, 5 final consumer)
 * and associated identifiers.
 */
export function validateCounterpartyAgainstInvoiceType(
  inty: MoadianInvoiceType,
  tob: MoadianBuyerType | null,
  buyerDetails?: {
    nationalId?: string | null;
    economicCode?: string | null;
    passportNumber?: string | null;
  },
): void {
  if (inty === MoadianInvoiceType.RETAIL) {
    throw new MoadianCounterpartyValidationError(
      'صورتحساب نوع ۳ (فروشگاهی/پوز) توسط این سرویس ارسال نمی‌شود.',
    );
  }

  // Type 2 (without buyer) validation
  if (inty === MoadianInvoiceType.WITHOUT_BUYER) {
    if (tob === MoadianBuyerType.LEGAL) {
      throw new MoadianCounterpartyValidationError(
        'صورتحساب برای شخص حقوقی نمی‌تواند از نوع دوم (بدون مشخصات خریدار) باشد؛ نوع اول الزامی است.',
      );
    }
    if (tob === MoadianBuyerType.CIVIC) {
      throw new MoadianCounterpartyValidationError(
        'صورتحساب برای مشارکت مدنی نمی‌تواند از نوع دوم (بدون مشخصات خریدار) باشد؛ نوع اول الزامی است.',
      );
    }
    if (tob === MoadianBuyerType.FOREIGN_NATIONAL) {
      throw new MoadianCounterpartyValidationError(
        'صورتحساب برای اتباع غیرایرانی نمی‌تواند از نوع دوم باشد؛ ثبت کد فراگیر یا گذرنامه در نوع اول الزامی است.',
      );
    }
    return;
  }

  // Type 1 (with buyer) validation
  if (inty === MoadianInvoiceType.WITH_BUYER) {
    const nationalId = buyerDetails?.nationalId?.trim() ?? null;
    const economicCode = buyerDetails?.economicCode?.trim() ?? null;
    const passportNumber = buyerDetails?.passportNumber?.trim() ?? null;

    if (!tob) {
      if (!nationalId && !economicCode && !passportNumber) {
        throw new MoadianCounterpartyValidationError(
          'برای صورتحساب نوع اول (با مشخصات خریدار)، مشخصات خریدار (شناسه ملی، کد اقتصادی یا گذرنامه) الزامی است.',
        );
      }
      return;
    }

    switch (tob) {
      case MoadianBuyerType.LEGAL: {
        const hasValidBid = nationalId && /^\d{11}$/.test(nationalId);
        const hasValidTinb = economicCode && /^(\d{11}|\d{14})$/.test(economicCode);
        if (!hasValidBid && !hasValidTinb) {
          throw new MoadianCounterpartyValidationError(
            'برای شخص حقوقی، شناسه ملی ۱۱ رقمی یا کد اقتصادی ۱۱/۱۴ رقمی خریدار الزامی است.',
          );
        }
        break;
      }
      case MoadianBuyerType.NATURAL: {
        const hasValidBid = nationalId && /^\d{10}$/.test(nationalId);
        const hasValidTinb = economicCode && /^(\d{11}|\d{14})$/.test(economicCode);
        if (!hasValidBid && !hasValidTinb) {
          throw new MoadianCounterpartyValidationError(
            'برای شخص حقیقی در صورتحساب نوع اول، کد ملی ۱۰ رقمی خریدار الزامی است.',
          );
        }
        break;
      }
      case MoadianBuyerType.CIVIC: {
        const hasValidBid = nationalId && /^\d{12}$/.test(nationalId);
        if (!hasValidBid) {
          throw new MoadianCounterpartyValidationError(
            'برای مشارکت مدنی، شناسه ۱۲ رقمی مشارکت مدنی خریدار الزامی است.',
          );
        }
        break;
      }
      case MoadianBuyerType.FOREIGN_NATIONAL: {
        const hasValidBid = nationalId && /^\d{12}$/.test(nationalId);
        const hasValidBpn = passportNumber && /^[0-9A-Za-z]{1,9}$/.test(passportNumber);
        if (!hasValidBid && !hasValidBpn) {
          throw new MoadianCounterpartyValidationError(
            'برای اتباع غیرایرانی، کد فراگیر ۱۲ رقمی (bid) یا شماره گذرنامه حداکثر ۹ کاراکتری (bpn) الزامی است.',
          );
        }
        break;
      }
      case MoadianBuyerType.FINAL_CONSUMER:
        // Final consumer can be Type 1 if identified by 10-digit national ID
        if (nationalId && !/^\d{10}$/.test(nationalId)) {
          throw new MoadianCounterpartyValidationError(
            'برای مصرف‌کننده نهایی در صورتحساب نوع اول، کد ملی ۱۰ رقمی الزامی است.',
          );
        }
        break;
      default:
        break;
    }
  }
}

/**
 * Dedicated payload transformer for Moadian invoice patterns 1 to 4, export pattern 7,
 * and subjects (Main, Corrective, Cancellation, Return).
 */
export class MoadianPayloadTransformer {
  /**
   * Transforms a sales invoice into a Pattern 1 (فروش) Moadian packet.
   */
  static transformPattern1Sale(
    invoice: InvoiceResponseDto,
    context: MoadianMappingContext,
    lineOverrides?: Pattern1SaleLineOptions[],
  ): MoadianInvoicePacket {
    const extras = { ...context.extras };
    if (lineOverrides?.length) {
      extras.items = lineOverrides.map((override, i) => ({
        ...(extras.items?.[i] ?? {}),
        ...override,
      }));
    }
    return mapInvoiceToMoadianPacket(invoice, {
      ...context,
      pattern: MoadianInvoicePattern.SALE,
      extras,
    });
  }

  /**
   * Transforms a currency sales invoice into a Pattern 2 (فروش ارزی) Moadian packet.
   */
  static transformPattern2Currency(
    invoice: InvoiceResponseDto,
    context: MoadianMappingContext,
    currencyLines: Pattern2CurrencyLineOptions[],
  ): MoadianInvoicePacket {
    if (!currencyLines?.length) {
      throw new MoadianMappingError('برای الگوی ۲ (فروش ارزی)، اطلاعات سطرهای ارزی الزامی است.');
    }
    const items = currencyLines.map((line) => {
      if (!(line.cpr > 0 && line.cpr < line.exr)) {
        throw new MoadianMappingError('در الگوی ۲ (فروش ارزی)، نرخ cpr باید بزرگ‌تر از صفر و کوچک‌تر از exr باشد.');
      }
      return {
        cfee: line.cfee,
        cut: line.cut,
        exr: line.exr,
        cpr: line.cpr,
        sovat: line.sovat,
        dis: line.dis ?? 0,
        vra: line.vra ?? 0,
      };
    });
    return mapInvoiceToMoadianPacket(invoice, {
      ...context,
      pattern: MoadianInvoicePattern.SALE_CURRENCY,
      extras: {
        ...context.extras,
        items,
      },
    });
  }

  /**
   * Transforms a gold/jewelry invoice into a Pattern 3 (طلا، جواهر و پلاتین) Moadian packet.
   */
  static transformPattern3Gold(
    invoice: InvoiceResponseDto,
    context: MoadianMappingContext,
    goldLines: Pattern3GoldLineOptions[],
  ): MoadianInvoicePacket {
    if (!goldLines?.length) {
      throw new MoadianMappingError('برای الگوی ۳ (طلا و جواهر)، اطلاعات اجرت و سود سطرهای طلا الزامی است.');
    }
    const items = goldLines.map((line) => {
      const tcpbs = Number(line.consfee ?? 0) + Number(line.spro ?? 0) + Number(line.bros ?? 0);
      return {
        consfee: line.consfee,
        spro: line.spro,
        bros: line.bros,
        tcpbs,
        cop: line.cop ?? null,
        vop: line.vop ?? null,
        cui: line.cui ?? null,
        dis: line.dis ?? 0,
        vra: line.vra ?? 0,
      };
    });
    return mapInvoiceToMoadianPacket(invoice, {
      ...context,
      pattern: MoadianInvoicePattern.GOLD,
      extras: {
        ...context.extras,
        items,
      },
    });
  }

  /**
   * Transforms a contracting invoice into a Pattern 4 (قرارداد پیمانکاری) Moadian packet.
   */
  static transformPattern4Contract(
    invoice: InvoiceResponseDto,
    context: MoadianMappingContext,
    contractHeader: Pattern4ContractHeaderOptions,
    contractLines?: Pattern4ContractLineOptions[],
  ): MoadianInvoicePacket {
    if (!contractHeader?.crn || !/^\d{1,12}$/.test(contractHeader.crn)) {
      throw new MoadianMappingError(
        'برای الگوی ۴ (قرارداد پیمانکاری)، شناسه یکتای قرارداد (crn) حداکثر ۱۲ رقم الزامی است.',
      );
    }
    const header = {
      ...(context.extras?.header ?? {}),
      crn: contractHeader.crn,
    };
    const items = contractLines?.map((line, i) => ({
      ...(context.extras?.items?.[i] ?? {}),
      ...(line.bsrn ? { bsrn: line.bsrn } : {}),
      ...(line.dis !== undefined ? { dis: line.dis } : {}),
      ...(line.vra !== undefined ? { vra: line.vra } : {}),
    }));
    return mapInvoiceToMoadianPacket(invoice, {
      ...context,
      pattern: MoadianInvoicePattern.CONTRACT,
      extras: {
        ...context.extras,
        header,
        ...(items ? { items } : {}),
      },
    });
  }

  /**
   * Transforms an export invoice into a Pattern 7 (صادرات) Moadian packet.
   */
  static transformPattern7Export(
    invoice: InvoiceResponseDto,
    context: MoadianMappingContext,
    exportHeader: Pattern7ExportHeaderOptions,
    exportLines: Pattern7ExportLineOptions[],
  ): MoadianInvoicePacket {
    if (context.subject === MoadianInvoiceSubject.CORRECTIVE) {
      throw new MoadianMappingError(
        'برای الگوی ۷ (صادرات)، صورتحساب اصلاحی (موضوع ۲) طبق دستورالعمل مودیان مجاز نیست.',
      );
    }
    if (!exportLines?.length) {
      throw new MoadianMappingError('برای الگوی ۷ (صادرات)، مشخصات گمرکی سطرهای صادراتی الزامی است.');
    }
    const header = {
      ...(context.extras?.header ?? {}),
      ...(exportHeader.cdcn ? { cdcn: exportHeader.cdcn } : {}),
      ...(exportHeader.cdcd ? { cdcd: exportHeader.cdcd } : {}),
      ...(exportHeader.tonw !== undefined ? { tonw: exportHeader.tonw } : {}),
      ...(exportHeader.torv !== undefined ? { torv: exportHeader.torv } : {}),
      ...(exportHeader.tocv !== undefined ? { tocv: exportHeader.tocv } : {}),
    };
    const items = exportLines.map((line) => ({
      cut: line.cut,
      exr: line.exr,
      ssrv: line.ssrv,
      sscv: line.sscv,
      ...(line.nw !== undefined ? { nw: line.nw } : {}),
      vra: 0,
      vam: 0,
    }));
    return mapInvoiceToMoadianPacket(invoice, {
      ...context,
      pattern: MoadianInvoicePattern.EXPORT,
      extras: {
        ...context.extras,
        header,
        items,
      },
    });
  }

  /**
   * Transforms an invoice into an Amendment / Corrective (اصلاحی) Moadian packet.
   */
  static transformCorrective(
    invoice: InvoiceResponseDto,
    referenceTaxId: string,
    context: MoadianMappingContext,
  ): MoadianInvoicePacket {
    if (!referenceTaxId || referenceTaxId.length !== 22) {
      throw new MoadianMappingError(
        'شماره منحصر‌به‌فرد مالیاتی مرجع (irtaxid) برای صورتحساب اصلاحی باید دقیقاً ۲۲ کاراکتر باشد.',
      );
    }
    if ((context.pattern ?? MoadianInvoicePattern.SALE) === MoadianInvoicePattern.EXPORT) {
      throw new MoadianMappingError(
        'برای الگوی ۷ (صادرات)، صورتحساب اصلاحی طبق مقررات سامانه مودیان مجاز نیست.',
      );
    }
    return mapInvoiceToMoadianPacket(invoice, {
      ...context,
      subject: MoadianInvoiceSubject.CORRECTIVE,
      referenceTaxId,
    });
  }

  /**
   * Transforms an invoice into a Cancellation (ابطالی) Moadian packet.
   */
  static transformCancellation(
    invoice: InvoiceResponseDto,
    referenceTaxId: string,
    context: MoadianMappingContext,
  ): MoadianInvoicePacket {
    if (!referenceTaxId || referenceTaxId.length !== 22) {
      throw new MoadianMappingError(
        'شماره منحصر‌به‌فرد مالیاتی مرجع (irtaxid) برای صورتحساب ابطالی باید دقیقاً ۲۲ کاراکتر باشد.',
      );
    }
    return mapInvoiceToMoadianPacket(invoice, {
      ...context,
      subject: MoadianInvoiceSubject.CANCELLATION,
      referenceTaxId,
    });
  }

  /**
   * Transforms an invoice into a Sales Return (برگشت از فروش) Moadian packet.
   */
  static transformReturn(
    invoice: InvoiceResponseDto,
    referenceTaxId: string,
    context: MoadianMappingContext,
  ): MoadianInvoicePacket {
    if (!referenceTaxId || referenceTaxId.length !== 22) {
      throw new MoadianMappingError(
        'شماره منحصر‌به‌فرد مالیاتی مرجع (irtaxid) برای صورتحساب برگشت از فروش باید دقیقاً ۲۲ کاراکتر باشد.',
      );
    }
    return mapInvoiceToMoadianPacket(invoice, {
      ...context,
      subject: MoadianInvoiceSubject.RETURN,
      referenceTaxId,
    });
  }
}
