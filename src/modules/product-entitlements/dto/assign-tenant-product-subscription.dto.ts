import { IsInt, IsString, IsUUID, Matches, Min } from 'class-validator';

export class AssignTenantProductSubscriptionDto {
  @IsUUID()
  gymId: string;

  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,63}$/)
  planCode: string;

  @IsInt()
  @Min(1)
  version: number;
}
