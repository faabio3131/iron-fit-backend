import { IsUUID } from 'class-validator';

export class PrepareMediaIngestionDto {
  @IsUUID()
  requestKey!: string;
}
