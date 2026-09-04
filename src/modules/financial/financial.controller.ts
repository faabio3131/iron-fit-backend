import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { FinancialService } from './financial.service';
import { CreateFinancialAccountDto } from './dto/create-financial-account.dto';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { CreateChargeDto } from './dto/create-charge.dto';
import { PayChargeDto } from './dto/pay-charge.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { resolveTenantOperationGymId } from '../../common/security/tenant-operation-scope';

@Controller('financial')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinancialController {
  constructor(private financialService: FinancialService) {}

  private resolveGymId(user: any, requestedGymId?: string) {
    return resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
  }

  @Post('accounts')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  createAccount(@Body() dto: CreateFinancialAccountDto, @CurrentUser() user: any) {
    const gymId = this.resolveGymId(user, dto.gymId);
    return this.financialService.createAccount(dto, gymId, user.id);
  }

  @Get('accounts')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  findAllAccounts(@CurrentUser() user: any, @Query('gymId') requestedGymId?: string) {
    return this.financialService.findAllAccounts(this.resolveGymId(user, requestedGymId));
  }

  @Post('subscriptions')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  createSubscription(
    @Body() dto: CreateSubscriptionDto,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    return this.financialService.createSubscription(
      dto,
      this.resolveGymId(user, requestedGymId),
      user.id,
    );
  }

  @Post('charges')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  createCharge(
    @Body() dto: CreateChargeDto,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    return this.financialService.createCharge(
      dto,
      this.resolveGymId(user, requestedGymId),
      user.id,
    );
  }

  @Get('charges')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  findAllCharges(@CurrentUser() user: any, @Query('gymId') requestedGymId?: string) {
    return this.financialService.findAllCharges(this.resolveGymId(user, requestedGymId));
  }

  @Patch('charges/:id/pay')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  payCharge(
    @Param('id') id: string,
    @Body() dto: PayChargeDto,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    return this.financialService.payCharge(
      id,
      dto,
      this.resolveGymId(user, requestedGymId),
      user.id,
    );
  }
}
