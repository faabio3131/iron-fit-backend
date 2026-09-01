import { IsString, IsOptional, IsUrl } from 'class-validator';

export class CreateGymDto {
  @IsString()
  name: string;

  @IsString()
  slug: string;

  @IsUrl()
  @IsOptional()
  logoUrl?: string;

  @IsString()
  @IsOptional()
  timezone?: string;
}
