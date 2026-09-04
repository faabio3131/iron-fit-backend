import { Equals, IsIn, Matches } from 'class-validator';

export class SignAggregatorAgreementDto {
  @Equals(true)
  accepted!: boolean;

  @Matches(/^[a-fA-F0-9]{64}$/)
  documentHash!: string;

  @Matches(/^[a-fA-F0-9]{64}$/)
  acceptanceEvidenceHash!: string;

  @IsIn([
    'ELECTRONIC_ACCEPTANCE',
    'DIGITAL_SIGNATURE',
    'PROVIDER_ATTESTATION',
  ])
  method!: string;
}
