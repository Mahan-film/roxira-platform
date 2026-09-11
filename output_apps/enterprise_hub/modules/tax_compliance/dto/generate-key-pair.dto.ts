import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, ValidateNested } from 'class-validator';
import { RSA_MODULUS_LENGTH } from '../constants/tax-compliance.constants';
import { CertificateSubjectDto } from './certificate-subject.dto';

/**
 * DTO تولید زوج‌کلید RSA مالیاتی
 * (POST /enterprise-hub/tax-compliance/keys).
 */
export class GenerateKeyPairDto {
  @ApiPropertyOptional({
    description: 'طول کلید RSA (بیت)',
    enum: [2048, 3072, 4096],
    default: RSA_MODULUS_LENGTH,
  })
  @IsOptional()
  @IsIn([2048, 3072, 4096])
  modulusLength?: number;

  @ApiPropertyOptional({
    type: CertificateSubjectDto,
    description:
      'موضوع گواهی؛ در صورت ارسال، درخواست امضای گواهی (CSR) نیز هم‌زمان تولید می‌شود.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CertificateSubjectDto)
  subject?: CertificateSubjectDto;
}
