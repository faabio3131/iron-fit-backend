import { IsIn, IsString } from 'class-validator';
import { StepUpDto } from '../../auth/dto/identity-security.dto';

export class IntegrationDrAssessDto extends StepUpDto {}

export class IntegrationDrReconcileDto extends StepUpDto {
  @IsString()
  @IsIn(['MARK_UNVERIFIED_CONNECTIONS_DEGRADED'])
  confirmation!: 'MARK_UNVERIFIED_CONNECTIONS_DEGRADED';
}
