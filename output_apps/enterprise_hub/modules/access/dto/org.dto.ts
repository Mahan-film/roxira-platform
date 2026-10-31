import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Acme Trading' })
  @Transform(trimmed)
  @IsString()
  @Length(2, 150)
  name: string;
}

export class CreateInvitationDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trimmed) @IsString() @MaxLength(254) email?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trimmed) @IsString() @MaxLength(20) phone?: string;
  @ApiProperty({ description: 'System role key or "custom"' }) @IsString() @MaxLength(40) roleKey: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customRoleId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() branchScoped?: boolean;
  @ApiPropertyOptional({ enum: ['en', 'fa'] }) @IsOptional() @IsIn(['en', 'fa']) locale?: 'en' | 'fa';
}

export class AcceptInvitationDto {
  @ApiProperty() @IsString() @Length(20, 200) token: string;
}

export class UpdateMemberDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) roleKey?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customRoleId?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() branchId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() departmentId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() branchScoped?: boolean;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED'] }) @IsOptional() @IsIn(['ACTIVE', 'SUSPENDED']) status?: 'ACTIVE' | 'SUSPENDED';
}

export class CreateManagedMemberDto {
  @ApiProperty({ example: 'ali.sales' }) @Transform(trimmed) @IsString() @Length(3, 32) username: string;
  @ApiProperty() @IsString() @Length(10, 128) password: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trimmed) @IsString() @MaxLength(120) displayName?: string;
  @ApiProperty({ description: 'System role key or "custom"' }) @IsString() @MaxLength(40) roleKey: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customRoleId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() branchScoped?: boolean;
}

export class ResetManagedPasswordDto {
  @ApiProperty() @IsString() @Length(10, 128) password: string;
}

export class CreateRoleDto {
  @ApiProperty() @Transform(trimmed) @IsString() @Length(2, 80) name: string;
  @ApiProperty({ type: [String], example: ['crm:read', 'crm:create'] })
  @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) permissions: string[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trimmed) @IsString() @Length(2, 80) name?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) permissions?: string[];
}

export class CreateBranchDto {
  @ApiProperty() @Transform(trimmed) @IsString() @Length(1, 120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() parentId?: string;
}

export class UpdateBranchDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trimmed) @IsString() @Length(1, 120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) code?: string;
}

export class CreateDepartmentDto {
  @ApiProperty() @Transform(trimmed) @IsString() @Length(1, 120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}

export class UpdateSecurityPolicyDto {
  @ApiProperty() @IsBoolean() require2fa: boolean;
}

export class AuditQueryDto {
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) before?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) action?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() actor?: string;
}

export class EntitlementChangeDto {
  @ApiProperty() @IsString() @MaxLength(40) module: string;
  @ApiProperty() @IsBoolean() enabled: boolean;
}

export class SetEntitlementsDto {
  @ApiProperty({ type: [EntitlementChangeDto] })
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => EntitlementChangeDto)
  changes: EntitlementChangeDto[];
}

export class RequestModuleDto {
  @ApiProperty() @IsString() @MaxLength(40) module: string;
}
