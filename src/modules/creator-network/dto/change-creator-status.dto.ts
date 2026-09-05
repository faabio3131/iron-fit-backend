import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ChangeCreatorStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'RETIRED'])
  status: 'ACTIVE' | 'SUSPENDED' | 'RETIRED';

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  @IsOptional()
  reason?: string;
}
