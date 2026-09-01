import { IsString, IsOptional, IsUUID, IsObject } from 'class-validator';

export class CreateAutomationDto {
  @IsUUID()
  @IsOptional()
  gymId?: string;

  @IsString()
  name: string;

  @IsString()
  triggerEvent: string;

  @IsObject()
  @IsOptional()
  conditions?: any;

  @IsObject()
  @IsOptional()
  actions?: any;
}
