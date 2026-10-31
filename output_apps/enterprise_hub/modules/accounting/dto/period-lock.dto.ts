import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Body of `POST period-locks`: locks the inclusive date range for the caller's tenant. */
export class LockPeriodDto {
  @ApiProperty({ description: 'First locked day (YYYY-MM-DD)', example: '2026-01-01' })
  @Matches(DATE_ONLY, { message: 'periodStart must be YYYY-MM-DD' })
  periodStart: string;

  @ApiProperty({ description: 'Last locked day (YYYY-MM-DD)', example: '2026-03-31' })
  @Matches(DATE_ONLY, { message: 'periodEnd must be YYYY-MM-DD' })
  periodEnd: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/** Body of `POST period-locks/:id/unlock`: a reason is mandatory (audit trail). */
export class UnlockPeriodDto {
  @ApiProperty({ minLength: 5, maxLength: 200 })
  @IsString()
  @MinLength(5)
  @MaxLength(200)
  reason: string;
}

export class PeriodLockResponseDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: '2026-01-01' }) periodStart: string;
  @ApiProperty({ example: '2026-03-31' }) periodEnd: string;
  @ApiProperty({ nullable: true, type: String }) reason: string | null;
  @ApiProperty() lockedBy: string;
  @ApiProperty() lockedAt: Date;
  @ApiProperty({ description: 'True while the lock is in force' }) active: boolean;
  @ApiProperty({ nullable: true, type: Date }) unlockedAt: Date | null;
  @ApiProperty({ nullable: true, type: String }) unlockedBy: string | null;
  @ApiProperty({ nullable: true, type: String }) unlockReason: string | null;
}
