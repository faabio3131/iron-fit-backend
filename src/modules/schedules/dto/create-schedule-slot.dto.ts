import { IsInt, IsString, IsOptional, IsUUID, IsBoolean, Min, Max } from 'class-validator';

export class CreateScheduleSlotDto {
  @IsUUID()
  @IsOptional()
  gymId?: string;

  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  @IsString()
  startTime: string;

  @IsString()
  endTime: string;

  @IsInt()
  capacity: number;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
