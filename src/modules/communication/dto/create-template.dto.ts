import { IsString, IsOptional, IsObject, IsUUID } from 'class-validator';

export class CreateTemplateDto {
  @IsUUID()
  @IsOptional()
  gymId?: string;

  @IsString()
  name: string;

  @IsString()
  channel: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  body: string;

  @IsObject()
  @IsOptional()
  variables?: any;
}
