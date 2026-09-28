import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { MessageChannel } from '@prisma/client';

export class SendMessageDto {
  @IsUUID()
  studentId: string;

  @IsUUID()
  @IsOptional()
  templateId?: string;

  @IsEnum(MessageChannel)
  channel: MessageChannel;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  body: string;
}
