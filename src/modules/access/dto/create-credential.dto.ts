import { IsUUID, IsString, IsOptional, IsDateString } from 'class-validator';

export class CreateCredentialDto {
  @IsUUID()
  studentId: string;

  @IsString()
  @IsOptional()
  type?: string;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}
