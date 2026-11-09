import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsUUID, Matches } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StepUpGuard } from '../auth/guards/step-up.guard';
import { IronCommercialCheckoutService } from './iron-commercial-checkout.service';

class OwnerCheckoutDto {
  @Matches(/^[A-Z][A-Z0-9_]{1,63}$/)
  planCode: string;

  @IsUUID()
  requestId: string;
}

@Controller('commercial/billing')
@UseGuards(JwtAuthGuard, RolesGuard, StepUpGuard)
export class IronCommercialCheckoutController {
  constructor(private readonly checkout: IronCommercialCheckoutService) {}

  /** Only the verified tenant OWNER may initiate an FM-owned checkout. */
  @Roles('OWNER')
  @Post('checkout')
  prepare(@CurrentUser() user: any, @Body() dto: OwnerCheckoutDto) {
    return this.checkout.prepare(user?.activeGymId ?? user?.gymId, dto.planCode, dto.requestId);
  }
}
