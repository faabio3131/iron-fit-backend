import { IsString, MaxLength, MinLength } from 'class-validator';

export class AcceptStudentInviteDto {
  @IsString()
  @MinLength(32)
  token: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password: string;
}
