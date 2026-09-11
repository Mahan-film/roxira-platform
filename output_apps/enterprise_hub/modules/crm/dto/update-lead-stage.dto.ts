import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { PipelineStage } from '../enums/crm.enums';

/**
 * DTO تغییر مرحله فروش سرنخ
 * (PATCH /enterprise-hub/crm/leads/:id/stage).
 */
export class UpdateLeadStageDto {
  @ApiProperty({
    description: 'مرحله جدید پایپ‌لاین',
    enum: PipelineStage,
    example: PipelineStage.QUALIFIED,
  })
  @IsEnum(PipelineStage)
  pipelineStage: PipelineStage;
}
