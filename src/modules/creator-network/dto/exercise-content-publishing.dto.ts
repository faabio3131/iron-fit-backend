import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateExerciseContentMappingDto {
  @IsUUID()
  contentId!: string;

  @IsUUID()
  mediaAssetId!: string;

  @IsIn(['PRIMARY', 'ALTERNATIVE'])
  placement!: 'PRIMARY' | 'ALTERNATIVE';

  @Transform(({ value }) => (value === undefined ? 100 : Number(value)))
  @IsInt()
  @Min(1)
  @Max(1000)
  priority = 100;
}

export class UnpublishExerciseContentMappingDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
