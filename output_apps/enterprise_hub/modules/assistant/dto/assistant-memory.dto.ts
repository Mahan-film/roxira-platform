import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/** A fact the user confirmed. The tenant and the confirming user come only from the JWT. */
export class ConfirmMemoryFactDto {
  @ApiProperty({ maxLength: 200, example: 'default VAT rate' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject: string;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  fact: string;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  conversationId?: string;

  @ApiPropertyOptional({ description: 'When the fact starts to be true (default now).' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validFrom?: Date;
}

export class RecallMemoryDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @ApiPropertyOptional({ description: 'Facts true at this instant (default now).' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validAt?: Date;

  @ApiPropertyOptional({ description: 'Facts as known at this instant (default: current belief).' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  knownAt?: Date;

  @ApiPropertyOptional({ minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class MemoryFactIdDto {
  @IsUUID()
  id: string;
}
