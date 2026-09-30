import { IsInt, IsString, IsOptional, IsUUID, IsBoolean, Matches, Min, Max } from 'class-validator';

export class CreateScheduleSlotDto {
  @IsUUID()
  @IsOptional()
  gymId?: string;

  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  endTime: string;

  @IsInt()
  @Min(1)
  capacity: number;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
