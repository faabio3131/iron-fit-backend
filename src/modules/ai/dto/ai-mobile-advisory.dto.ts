import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class AiWorkoutInsightsDto {
  @IsIn(['workout_insights', 'evolution_projection'])
  @IsOptional()
  kind?: 'workout_insights' | 'evolution_projection';

  // Accepted only for mobile wire compatibility. Server-side context is rebuilt
  // from the authenticated identity and canonical tenant data.
  @IsObject()
  @IsOptional()
  context?: Record<string, unknown>;
}

export class AiChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;

  // Never authoritative. G5 deliberately rebuilds the actual model context.
  @IsObject()
  @IsOptional()
  context?: Record<string, unknown>;
}


export class AiContentRecommendationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  @IsOptional()
  exerciseIds?: string[];

  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  limit?: number;
}
