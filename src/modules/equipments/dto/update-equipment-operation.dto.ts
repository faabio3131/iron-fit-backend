import { IsIn } from 'class-validator';

export class UpdateEquipmentOperationDto {
  @IsIn(['OPERATIONAL', 'MAINTENANCE', 'OUT_OF_SERVICE'])
  status!: 'OPERATIONAL' | 'MAINTENANCE' | 'OUT_OF_SERVICE';
}
