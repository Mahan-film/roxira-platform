import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { CertificateSubjectDto } from './certificate-subject.dto';

/**
 * DTO تولید درخواست امضای گواهی (CSR)
 * (POST /enterprise-hub/tax-compliance/csr).
 */
export class GenerateCsrDto {
  @ApiProperty({
    type: CertificateSubjectDto,
    description: 'موضوع گواهی (RDNهای PKCS#10)',
  })
  @ValidateNested()
  @Type(() => CertificateSubjectDto)
  subject: CertificateSubjectDto;

  @ApiPropertyOptional({
    description:
      'کلید خصوصی PEM (PKCS#8)؛ در صورت عدم ارسال از کلید فعال مالیاتی سازمان استفاده می‌شود.',
  })
  @IsOptional()
  @IsString()
  @Matches(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, {
    message: 'کلید خصوصی باید در قالب PEM معتبر باشد.',
  })
  privateKeyPem?: string;
}
