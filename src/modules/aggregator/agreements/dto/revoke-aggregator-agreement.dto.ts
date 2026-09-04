import { IsString, Length } from 'class-validator';

export class RevokeAggregatorAgreementDto {
  @IsString()
  @Length(8, 500)
  reason!: string;
}
