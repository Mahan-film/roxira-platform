import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_REGEX,
  UiLocale,
} from '../constants/password-auth.constants';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const lowered = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Sign-up with username and/or email plus a password. At least one identifier is required. */
export class SignupDto {
  @ApiPropertyOptional({ example: 'jane.doe' })
  @IsOptional()
  @Transform(lowered)
  @Length(USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH)
  @Matches(USERNAME_REGEX, {
    message: 'Username may use letters, digits, dot, underscore and dash.',
  })
  username?: string;

  @ApiPropertyOptional({ example: 'jane@example.com' })
  @IsOptional()
  @Transform(lowered)
  @IsString()
  @MaxLength(EMAIL_MAX_LENGTH)
  email?: string;

  @ApiProperty({ minLength: 10, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;

  @ApiPropertyOptional({ example: 'Jane Doe' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @ApiPropertyOptional({ description: 'Optional. Creates an organisation owned by the new account; omit to create or join one later.' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(150)
  organizationName?: string;

  @ApiPropertyOptional({ description: 'Invitation token: join that organisation instead of creating one.' })
  @IsOptional()
  @IsString()
  @Length(20, 200)
  inviteToken?: string;
}

export class PasswordLoginDto {
  @ApiProperty({ description: 'Username or email', example: 'jane@example.com' })
  @Transform(lowered)
  @IsString()
  @Length(3, EMAIL_MAX_LENGTH)
  identifier: string;

  @ApiProperty()
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ description: 'Username or email' })
  @Transform(lowered)
  @IsString()
  @Length(3, EMAIL_MAX_LENGTH)
  identifier: string;

  @ApiPropertyOptional({ enum: ['fa', 'en'], description: 'Language and portal for the email link.' })
  @IsOptional()
  @IsIn(['fa', 'en'])
  locale?: UiLocale;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @Length(20, 200)
  token: string;

  @ApiProperty({ minLength: 10, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword: string;
}

/** Set or change the password of the signed-in user (also how an SMS-only user adds one). */
export class SetPasswordDto {
  @ApiProperty({ minLength: 10, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword: string;

  @ApiPropertyOptional({ description: 'Required when the account already has a password.' })
  @IsOptional()
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword?: string;

  @ApiPropertyOptional({ description: 'Login name to attach (only if the account has none).' })
  @IsOptional()
  @Transform(lowered)
  @Length(USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH)
  @Matches(USERNAME_REGEX, {
    message: 'Username may use letters, digits, dot, underscore and dash.',
  })
  username?: string;

  @ApiPropertyOptional({ description: 'Email to attach (only if the account has none).' })
  @IsOptional()
  @Transform(lowered)
  @IsString()
  @MaxLength(EMAIL_MAX_LENGTH)
  email?: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @Length(20, 200)
  refreshToken: string;
}

export class GenericMessageDto {
  @ApiProperty()
  message: string;
}

export class MfaLoginDto {
  @ApiProperty() @IsString() @Length(20, 200) challenge: string;
  @ApiProperty({ description: '6-digit authenticator code or a recovery code' })
  @Transform(trimmed) @IsString() @Length(6, 20) code: string;
}

export class TotpCodeDto {
  @ApiProperty() @Transform(trimmed) @IsString() @Length(6, 20) code: string;
}

export class SwitchTenantDto {
  @ApiProperty() @IsUUID() tenantId: string;
}
