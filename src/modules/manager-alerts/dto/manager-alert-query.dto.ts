import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

const CATEGORIES = [
  'STUDENT_BILLING', 'ATTENDANCE_RISK', 'ASSESSMENT_WORKOUT', 'EQUIPMENT',
  'DELIVERY_FAILURE', 'INTEGRATION_HEALTH', 'PLAN_LIMIT', 'SECURITY',
  'OPERATIONAL_INCIDENT', 'HUMAN_APPROVAL',
] as const;

export class ManagerAlertQueryDto {
  @IsOptional()
  @IsIn(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'])
  status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED';

  @IsOptional()
  @IsIn(['INFO', 'WARNING', 'CRITICAL'])
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: (typeof CATEGORIES)[number];

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 30;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  offset = 0;
}
