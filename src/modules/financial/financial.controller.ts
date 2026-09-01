import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { FinancialService } from './financial.service';
import { CreateFinancialAccountDto } from './dto/create-financial-account.dto';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { CreateChargeDto } from './dto/create-charge.dto';
import { PayChargeDto } from './dto/pay-charge.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('financial')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinancialController {
  constructor(private financialService: FinancialService) {}

  @Post('accounts')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  createAccount(@Body() dto: CreateFinancialAccountDto, @CurrentUser() user: any) {
    return this.financialService.createAccount(dto, user.gymId);
  }

  @Get('accounts')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  findAllAccounts(@CurrentUser() user: any) {
    return this.financialService.findAllAccounts(user.gymId);
  }

  @Post('subscriptions')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  createSubscription(@Body() dto: CreateSubscriptionDto, @CurrentUser() user: any) {
    return this.financialService.createSubscription(dto, user.gymId);
  }

  @Post('charges')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  createCharge(@Body() dto: CreateChargeDto, @CurrentUser() user: any) {
    return this.financialService.createCharge(dto, user.gymId);
  }

  @Get('charges')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  findAllCharges(@CurrentUser() user: any) {
    return this.financialService.findAllCharges(user.gymId);
  }

  @Patch('charges/:id/pay')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  payCharge(
    @Param('id') id: string,
    @Body() dto: PayChargeDto,
    @CurrentUser() user: any,
  ) {
    return this.financialService.payCharge(id, dto, user.gymId);
  }
}
