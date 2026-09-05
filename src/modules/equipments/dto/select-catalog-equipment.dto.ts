import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class SelectCatalogEquipmentDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(250)
  @IsUUID('4', { each: true })
  catalogItemIds: string[];
}
