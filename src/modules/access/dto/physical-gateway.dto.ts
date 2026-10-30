import { IsIn, IsInt, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class GatewayDeviceAuthDto {
  @IsUUID()
  deviceId: string;

  @IsString()
  @MinLength(32)
  deviceToken: string;

  @IsString()
  @MinLength(16)
  @MaxLength(128)
  nonce: string;

  @IsInt()
  timestamp: number;
}

export class GatewayClaimDto extends GatewayDeviceAuthDto {}

export class GatewayIdentifyDto extends GatewayDeviceAuthDto {
  @IsString()
  @MinLength(1)
  qrToken: string;

  @IsIn(['ENTRY', 'EXIT'])
  direction: 'ENTRY' | 'EXIT';
}

export class GatewayAckDto extends GatewayDeviceAuthDto {
  @IsString()
  @MinLength(1)
  authorizationId: string;

  @IsIn(['ACCEPTED', 'REJECTED', 'UNKNOWN'])
  status: 'ACCEPTED' | 'REJECTED' | 'UNKNOWN';
}

export class GatewayPassageDto extends GatewayDeviceAuthDto {
  @IsString()
  @MinLength(1)
  authorizationId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  vendorEventId: string;

  @IsString()
  occurredAt: string;

  @IsIn(['CONFIRMED', 'NOT_CONFIRMED'])
  outcome: 'CONFIRMED' | 'NOT_CONFIRMED';

  @IsString()
  @MinLength(64)
  signature: string;
}
