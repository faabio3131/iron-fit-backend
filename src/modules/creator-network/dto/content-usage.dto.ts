import {
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class RecordContentEngagementDto {
  @IsUUID()
  eventKey!: string;

  @IsIn([
    'CONTENT_OPENED',
    'CONTENT_PROGRESS',
    'CONTENT_COMPLETED',
    'CONTENT_DISMISSED',
  ])
  eventType!:
    | 'CONTENT_OPENED'
    | 'CONTENT_PROGRESS'
    | 'CONTENT_COMPLETED'
    | 'CONTENT_DISMISSED';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progressPercent?: number;
}
