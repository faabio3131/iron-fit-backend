import { IsString, IsOptional, IsUUID } from 'class-validator';

export class ScanDto {
  @IsString()
  qrToken: string;

  @IsUUID()
  @IsOptional()
  deviceId?: string;
}
