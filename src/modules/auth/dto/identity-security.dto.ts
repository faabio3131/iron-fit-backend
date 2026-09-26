import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

export class EmailOnlyDto {
  @IsEmail()
  email!: string;
}

export class ActionTokenDto {
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  token!: string;
}

export class PasswordResetConfirmDto extends ActionTokenDto {
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}

export class StepUpDto {
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  currentPassword!: string;

  @IsOptional()
  @IsString()
  @Length(6, 6)
  mfaCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  recoveryCode?: string;
}

export class ChangePasswordDto extends StepUpDto {
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}

export class RequestEmailChangeDto extends StepUpDto {
  @IsEmail()
  newEmail!: string;
}

export class ConfirmEmailChangeDto extends ActionTokenDto {}

export class MfaSetupDto {
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  currentPassword!: string;
}

export class MfaConfirmDto {
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class MfaDisableDto extends StepUpDto {}

export class RevokeSessionDto extends StepUpDto {
  @IsUUID()
  sessionId!: string;
}
