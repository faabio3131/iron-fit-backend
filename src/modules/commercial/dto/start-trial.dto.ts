import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

export class StartTrialDto {
  @IsUUID()
  requestId!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
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
