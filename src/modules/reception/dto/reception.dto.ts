import { Equals, IsBoolean, IsDateString, IsIn, IsInt, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class DeskPlanDto {
  @IsString() @MinLength(2) @MaxLength(100) name: string;
  @IsInt() @Min(1) @Max(100000000) amount: number;
  @IsIn([1, 3, 6, 12]) intervalMonths: number;
}
export class DeskPlanStatusDto { @IsBoolean() active: boolean; }
export class DeskPolicyDto {
  @IsUUID() accountId: string;
  @IsBoolean() enabled: boolean;
}
export class DeskEnrollDto {
  @IsUUID() requestId: string;
  @IsUUID() studentId: string;
  @IsUUID() planId: string;
  @IsDateString() dueDate: string;
  @IsIn(['CASH', 'PIX', 'CREDIT_CARD', 'DEBIT_CARD']) paymentMethod: string;
  @Equals(true) receivedConfirmed: boolean;
}

export class DeskReceiveDto {
  @IsUUID() requestId: string;
  @IsIn(['CASH', 'PIX', 'CREDIT_CARD', 'DEBIT_CARD']) paymentMethod: string;
  @Equals(true) receivedConfirmed: boolean;
}
