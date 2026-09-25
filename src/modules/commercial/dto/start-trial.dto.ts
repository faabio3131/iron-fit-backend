import { IsEmail, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class StartTrialDto {
  @IsUUID()
  requestId!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 128)
  password!: string;

  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(8, 30)
  phone?: string;

  @IsString()
  @Length(2, 160)
  gymName!: string;

  @IsOptional()
  @IsString()
  timezone?: string;
}
