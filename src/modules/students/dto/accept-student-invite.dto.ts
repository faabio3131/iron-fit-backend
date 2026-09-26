import { IsString, MinLength } from 'class-validator';

export class AcceptStudentInviteDto {
  @IsString()
  @MinLength(32)
  token: string;

  @IsString()
  @MinLength(12)
  password: string;
}
