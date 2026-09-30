import { IsBoolean } from 'class-validator';

export class UpdateMembershipStatusDto {
  @IsBoolean()
  active: boolean;
}
