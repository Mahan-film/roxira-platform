import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  CLIENT_ERROR_KINDS,
  ClientErrorKind,
  MAX_BUILD_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_PATH_LENGTH,
  MAX_STACK_LENGTH,
  MAX_USER_AGENT_LENGTH,
} from '../constants/client-errors.constants';

/** بدنهٔ گزارش خطای مرورگر؛ هیچ توکن، PII یا بدنهٔ درخواستی نباید در آن باشد. */
export class ReportClientErrorDto {
  @ApiProperty({ maxLength: MAX_MESSAGE_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_MESSAGE_LENGTH)
  message!: string;

  @ApiPropertyOptional({ maxLength: MAX_STACK_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_STACK_LENGTH)
  stack?: string;

  @ApiProperty({ description: 'URL path without query string', maxLength: MAX_PATH_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PATH_LENGTH)
  path!: string;

  @ApiPropertyOptional({ maxLength: MAX_USER_AGENT_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_USER_AGENT_LENGTH)
  userAgent?: string;

  @ApiPropertyOptional({ description: 'Build id / commit sha', maxLength: MAX_BUILD_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_BUILD_LENGTH)
  build?: string;

  @ApiPropertyOptional({ enum: CLIENT_ERROR_KINDS })
  @IsOptional()
  @IsIn(CLIENT_ERROR_KINDS)
  kind?: ClientErrorKind;

  @ApiPropertyOptional({ description: 'Client time, ISO 8601' })
  @IsOptional()
  @IsISO8601()
  timestamp?: string;
}
