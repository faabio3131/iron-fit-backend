import { IsUUID, IsDateString } from 'class-validator';

export class BookStudentDto {
  @IsUUID()
  studentId: string;

  @IsUUID()
  slotId: string;

  @IsDateString()
  date: string;
}
