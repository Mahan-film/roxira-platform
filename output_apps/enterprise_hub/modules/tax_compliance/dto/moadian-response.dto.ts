import { ApiProperty } from '@nestjs/swagger';
import { MoadianSettlementMethod, MoadianSubmissionStatus } from '../enums/moadian.enum';
import { MoadianMessage } from '../entities/moadian-submission.entity';

/** اطلاعات عمومی اتصال مستأجر (بدون کلید خصوصی). */
export class MoadianCredentialResponseDto {
  @ApiProperty() memoryId: string;
  @ApiProperty() economicCode: string;
  @ApiProperty() keyFingerprint: string;
  @ApiProperty({ nullable: true }) certificateSubject: string | null;
  @ApiProperty({ nullable: true }) certificateValidTo: string | null;
  @ApiProperty({ nullable: true }) defaultSstid: string | null;
  @ApiProperty({ nullable: true }) defaultMeasurementUnit: string | null;
  @ApiProperty({ enum: MoadianSettlementMethod }) settlementMethod: MoadianSettlementMethod;
  @ApiProperty({ description: 'آیا اتصال زنده (MOADIAN_ENABLED) روشن است' }) enabled: boolean;
  @ApiProperty() baseUrl: string;
  @ApiProperty() updatedAt: Date;
}

/** وضعیت ارسال یک صورتحساب به مودیان. */
export class MoadianSubmissionResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() invoiceId: string;
  @ApiProperty({ description: 'requestTraceId / uid' }) uid: string;
  @ApiProperty({ description: 'شماره منحصربه‌فرد مالیاتی ۲۲ کاراکتری' }) taxId: string;
  @ApiProperty({ nullable: true }) referenceNumber: string | null;
  @ApiProperty({ enum: MoadianSubmissionStatus }) status: MoadianSubmissionStatus;
  @ApiProperty({ type: [Object] }) errors: MoadianMessage[];
  @ApiProperty({ type: [Object] }) warnings: MoadianMessage[];
  @ApiProperty() pollCount: number;
  @ApiProperty({ nullable: true }) sentAt: Date | null;
  @ApiProperty({ nullable: true }) lastPolledAt: Date | null;
  @ApiProperty() updatedAt: Date;
}
