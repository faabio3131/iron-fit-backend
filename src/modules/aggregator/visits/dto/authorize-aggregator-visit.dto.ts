import { IsString, IsUUID, Length } from 'class-validator';

export class AuthorizeAggregatorVisitDto {
  @IsUUID()
  memberId!: string;

  @IsString()
  @Length(1, 128)
  externalVisitId!: string;
}
