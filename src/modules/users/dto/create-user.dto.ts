import { IsEmail, IsString, MinLength, IsOptional, IsUUID } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(12)
  password: string;

  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsUUID()
  @IsOptional()
  gymId?: string;

  @IsString()
  @IsOptional()
  roleName?: string;
}
