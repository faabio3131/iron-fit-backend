import { IsBoolean, IsIn, IsString, MaxLength, MinLength } from 'class-validator';

const manufacturers = ['CONTROL_ID', 'TOPDATA', 'HENRY', 'DIMEP'] as const;
const deviceTypes = ['QR_CODE', 'BIOMETRIC', 'FACIAL', 'TAG', 'MANUAL'] as const;

export class RegisterPhysicalDeviceDto {
  @IsIn(manufacturers)
  manufacturer: 'CONTROL_ID' | 'TOPDATA' | 'HENRY' | 'DIMEP';

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  model: string;

  @IsIn(deviceTypes)
  type: 'QR_CODE' | 'BIOMETRIC' | 'FACIAL' | 'TAG' | 'MANUAL';
}

export class SetPhysicalDeviceActiveDto {
  @IsBoolean()
  active: boolean;
}
