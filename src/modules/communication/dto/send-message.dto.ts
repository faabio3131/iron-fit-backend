import { IsString, IsOptional, IsUUID, IsObject } from 'class-validator';

export class SendMessageDto {
  @IsUUID()
  studentId: string;

  @IsUUID()
  @IsOptional()
  templateId?: string;

  @IsString()
  channel: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  body: string;
}
