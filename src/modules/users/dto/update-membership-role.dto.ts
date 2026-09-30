import { IsIn } from 'class-validator';

export class UpdateMembershipRoleDto {
  @IsIn(['MANAGER', 'RECEPTION', 'TRAINER'])
  roleName: 'MANAGER' | 'RECEPTION' | 'TRAINER';
}
