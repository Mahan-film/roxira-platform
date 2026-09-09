import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CreateDamageCalculationDto } from '../dto/create-damage-calculation.dto';
import { DamageCalculationResponseDto } from '../dto/damage-calculation-response.dto';
import { QueryDamageCalculationDto } from '../dto/query-damage-calculation.dto';
import { DamageCalculationMethod } from '../enums/calculation-method.enum';
import { DamagesRepository } from '../repositories/damages.repository';
import { DamageCalculationEntity } from '../entities/damage-calculation.entity';
import {
  DAMAGES_BULK_JOB_NAME,
  DAMAGES_QUEUE_NAME,
  LEGAL_BASIS_ANNUAL_RATE,
  LEGAL_BASIS_CPI,
} from '../constants/damages.constants';

const MILLISECONDS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * سرویس محاسبه خسارت تاخیر تادیه.
 * تمام منطق کسب‌وکار اینجا قرار دارد؛ Controller فقط مسیریابی می‌کند
 * و Repository فقط پرسیستنس انجام می‌دهد (Rule #3 - AGENTS.md).
 */
@Injectable()
export class DamagesService {
  constructor(
    private readonly damagesRepository: DamagesRepository,
    @InjectQueue(DAMAGES_QUEUE_NAME) private readonly damagesQueue: Queue,
  ) {}

  /**
   * محاسبه تعداد روزهای تاخیر بین سررسید و تاریخ پرداخت.
   */
  private calculateDelayedDays(dueDate: string, paymentDate: string): number {
    const due = new Date(dueDate);
    const payment = new Date(paymentDate);
    const diffMs = payment.getTime() - due.getTime();

    if (diffMs < 0) {
      throw new BadRequestException(
        'تاریخ پرداخت نمی‌تواند قبل از تاریخ سررسید باشد.',
      );
    }

    return Math.floor(diffMs / MILLISECONDS_PER_DAY);
  }

  /**
   * هسته محاسباتی خسارت تاخیر تادیه بر اساس روش انتخاب‌شده.
   * گرد کردن نتیجه تا ۲ رقم اعشار (ریال).
   */
  private computeDamageAmount(
    dto: CreateDamageCalculationDto,
    delayedDays: number,
  ): { damageAmount: number; legalBasis: string } {
    if (dto.calculationMethod === DamageCalculationMethod.CPI_INDEX) {
      if (!dto.cpiIndexAtDueDate || !dto.cpiIndexAtPaymentDate) {
        throw new BadRequestException(
          'برای روش CPI_INDEX، شاخص‌های بانک مرکزی در تاریخ سررسید و پرداخت الزامی است.',
        );
      }

      const growthRatio =
        (dto.cpiIndexAtPaymentDate - dto.cpiIndexAtDueDate) /
        dto.cpiIndexAtDueDate;

      // بر اساس رویه قضایی، خسارت تاخیر تادیه منفی (کاهش شاخص) پذیرفته نمی‌شود.
      const damageAmount = Math.max(0, dto.principalAmount * growthRatio);

      return {
        damageAmount: Math.round(damageAmount * 100) / 100,
        legalBasis: LEGAL_BASIS_CPI,
      };
    }

    if (dto.calculationMethod === DamageCalculationMethod.ANNUAL_RATE) {
      if (dto.annualInterestRate === undefined) {
        throw new BadRequestException(
          'برای روش ANNUAL_RATE، نرخ سود سالانه الزامی است.',
        );
      }

      const damageAmount =
        dto.principalAmount * (dto.annualInterestRate / 100) * (delayedDays / 365);

      return {
        damageAmount: Math.round(damageAmount * 100) / 100,
        legalBasis: LEGAL_BASIS_ANNUAL_RATE,
      };
    }

    throw new BadRequestException('روش محاسبه نامعتبر است.');
  }

  private toResponseDto(
    entity: DamageCalculationEntity,
  ): DamageCalculationResponseDto {
    return {
      id: entity.id,
      principalAmount: Number(entity.principalAmount),
      dueDate: entity.dueDate,
      paymentDate: entity.paymentDate,
      calculationMethod: entity.calculationMethod,
      delayedDays: entity.delayedDays,
      damageAmount: Number(entity.damageAmount),
      totalPayable: Number(entity.totalPayable),
      legalBasis: entity.legalBasis,
      contractReferenceNumber: entity.contractReferenceNumber,
      createdAt: entity.createdAt,
    };
  }

  /**
   * محاسبه و ثبت فوری (Synchronous) یک رکورد خسارت تاخیر تادیه.
   */
  async calculateAndPersist(
    dto: CreateDamageCalculationDto,
  ): Promise<DamageCalculationResponseDto> {
    const delayedDays = this.calculateDelayedDays(dto.dueDate, dto.paymentDate);
    const { damageAmount, legalBasis } = this.computeDamageAmount(dto, delayedDays);
    const totalPayable = Math.round((dto.principalAmount + damageAmount) * 100) / 100;

    const saved = await this.damagesRepository.create({
      principalAmount: dto.principalAmount,
      dueDate: dto.dueDate,
      paymentDate: dto.paymentDate,
      calculationMethod: dto.calculationMethod,
      delayedDays,
      damageAmount,
      totalPayable,
      legalBasis,
      contractReferenceNumber: dto.contractReferenceNumber,
    });

    return this.toResponseDto(saved);
  }

  /**
   * ثبت درخواست محاسبه دسته‌ای در صف BullMQ/Redis (Rule #5 - AGENTS.md:
   * Zero Hardware Waste - پردازش ناهمزمان برای جلوگیری از بلاک شدن Event Loop).
   */
  async enqueueBulkCalculation(
    items: CreateDamageCalculationDto[],
  ): Promise<{ jobId: string; itemCount: number }> {
    const job = await this.damagesQueue.add(DAMAGES_BULK_JOB_NAME, { items });
    return { jobId: job.id as string, itemCount: items.length };
  }

  async findAll(
    query: QueryDamageCalculationDto,
  ): Promise<{ data: DamageCalculationResponseDto[]; total: number; page: number; limit: number }> {
    const { page, limit, contractReferenceNumber } = query;

    const [entities, total] = await this.damagesRepository.findAndCount({
      where: contractReferenceNumber ? { contractReferenceNumber } : {},
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: entities.map((entity) => this.toResponseDto(entity)),
      total,
      page,
      limit,
    };
  }

  async findOne(id: string): Promise<DamageCalculationResponseDto> {
    const entity = await this.damagesRepository.findById(id);

    if (!entity) {
      throw new NotFoundException(`رکورد محاسبه با شناسه ${id} یافت نشد.`);
    }

    return this.toResponseDto(entity);
  }
}
