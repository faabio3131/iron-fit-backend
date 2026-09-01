import { IsString, IsOptional, IsDateString, IsBoolean, IsUUID, IsEnum } from 'class-validator';

export class CreateStudentDto {
  @IsUUID()
  gymId: string;

  @IsString()
  name: string;

  @IsString()
  email: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsDateString()
  @IsOptional()
  birthDate?: string;

  @IsString()
  @IsOptional()
  gender?: string;

  @IsString()
  @IsOptional()
  goal?: string;

  @IsString()
  @IsOptional()
  level?: string;

  @IsBoolean()
  @IsOptional()
  consentHealth?: boolean;

  @IsBoolean()
  @IsOptional()
  consentComm?: boolean;

  @IsBoolean()
  @IsOptional()
  consentBiometry?: boolean;
}
