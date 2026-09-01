import { IsString, IsOptional, IsInt, IsUUID } from 'class-validator';

export class CreateFinancialAccountDto {
  @IsUUID()
  @IsOptional()
  gymId?: string;

  @IsString()
  name: string;

  @IsString()
  type: string;

  @IsInt()
  @IsOptional()
  initialBalance?: number;
}
