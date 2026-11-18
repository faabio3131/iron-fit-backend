import { IsString, Matches } from 'class-validator';

// Stable for the entire guided session, including HTTP retry and uncertain response.
export class CompleteWorkoutSessionDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{20,96}$/, { message: 'Identificador da tentativa invalido' })
  requestId!: string;
}
