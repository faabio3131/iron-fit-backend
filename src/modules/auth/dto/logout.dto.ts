import { IsString, MinLength } from 'class-validator';

export class LogoutDto {
  @IsString()
  @MinLength(64)
  refreshToken: string;
}
