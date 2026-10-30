import { IsUUID } from 'class-validator';
export class ReconcileWebhookEventDto {
  @IsUUID()
  accountId!: string;
}
