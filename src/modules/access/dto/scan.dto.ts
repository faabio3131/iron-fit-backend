import { IsInt, IsString, IsUUID, MinLength } from 'class-validator';

export class ScanDto {
  @IsString()
  qrToken: string;

  @IsUUID()
  deviceId: string;

  @IsString()
  @MinLength(32)
  deviceToken: string;

  @IsString()
  @MinLength(16)
  nonce: string;

  @IsInt()
  timestamp: number;
}
