import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

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
