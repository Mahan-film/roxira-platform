import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsString, Matches } from 'class-validator';
import { StatementStatus } from '../enums/contracting.enum';
import { DATE_ONLY, MONEY_STRING } from './project.dto';

export class CreateStatementDto {
  @ApiProperty({ description: 'تاریخ صورت وضعیت (YYYY-MM-DD)' })
  @IsISO8601({ strict: true }) @Matches(DATE_ONLY)
  statementDate: string;

  @ApiProperty({ description: 'مبلغ تجمعی کارکرد تا این صورت وضعیت (ریال، رشته اعشاری)', example: '700000000' })
  @IsString() @Matches(MONEY_STRING, { message: 'مبلغ معتبر نیست.' })
  cumulativeAmount: string;
}

export class StatementResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() contractId: number;
  @ApiProperty() number: number;
  @ApiProperty() statementDate: string;
  @ApiProperty({ type: Object }) cumulativeAmount: number | string;
  @ApiProperty({ type: Object }) previousAmount: number | string;
  @ApiProperty({ type: Object }) periodAmount: number | string;
  @ApiProperty({ type: Object }) retentionAmount: number | string;
  @ApiProperty({ type: Object }) insuranceAmount: number | string;
  @ApiProperty({ type: Object }) advanceRecoveryAmount: number | string;
  @ApiProperty({ type: Object }) netPayable: number | string;
  @ApiProperty({ enum: StatementStatus }) status: StatementStatus;
  @ApiPropertyOptional({ nullable: true, type: Number }) journalEntryId: number | null;
  @ApiPropertyOptional({ nullable: true, type: String }) journalEntryNumber: string | null;
  @ApiPropertyOptional({ nullable: true, type: Date }) approvedAt: Date | null;
  @ApiPropertyOptional({ nullable: true, type: Date }) postedAt: Date | null;
  @ApiPropertyOptional({ description: 'true when the statement was already posted and nothing new was written' }) replayed?: boolean;
}
