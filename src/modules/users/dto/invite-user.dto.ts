import { IsEmail, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class InviteUserDto {
  @IsEmail()
  email: string;

  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsUUID()
  @IsOptional()
  gymId?: string;

  @IsIn(['MANAGER', 'RECEPTION', 'TRAINER'])
  roleName: 'MANAGER' | 'RECEPTION' | 'TRAINER';
}
