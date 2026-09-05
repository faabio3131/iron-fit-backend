import { IsInt, Min } from 'class-validator';

export class CreateProductPlanVersionDto {
  @IsInt()
  @Min(1)
  version: number;
}
