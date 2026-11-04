import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class TerminalCheckInDto {
  @IsUUID() requestId!: string;
  @IsOptional() @IsUUID() studentId?: string;
  @IsOptional() @IsString() @MinLength(16) @MaxLength(512) qrToken?: string;
}
