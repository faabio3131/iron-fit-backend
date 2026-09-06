import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateContentVersionDto {
  @IsUUID()
  mediaAssetId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  editorialTitle!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  editorialDescription?: string;
}

export class ReviewContentVersionDto {
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  @IsIn(['PASS', 'FAIL'])
  technicalQuality!: 'PASS' | 'FAIL';

  @IsIn(['PASS', 'FAIL'])
  instructionalQuality!: 'PASS' | 'FAIL';

  @IsIn(['PASS', 'FAIL'])
  safetyQuality!: 'PASS' | 'FAIL';

  @IsIn(['PASS', 'FAIL', 'NOT_APPLICABLE'])
  accessibilityQuality!: 'PASS' | 'FAIL' | 'NOT_APPLICABLE';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class ContentLifecycleReasonDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
