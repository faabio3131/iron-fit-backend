import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { FinancialService } from './financial.service';
import { StripePaymentWebhookInboxService } from './stripe-payment-webhook-inbox.service';
import { CreateFinancialAccountDto } from './dto/create-financial-account.dto';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { CreateChargeDto } from './dto/create-charge.dto';
import { PayChargeDto } from './dto/pay-charge.dto';
import { CreateChargePaymentSessionDto } from './dto/create-charge-payment-session.dto';
import { TenantPaymentCheckoutService } from './tenant-payment-checkout.service';
import { TenantPaymentReconciliationService } from './tenant-payment-reconciliation.service';
import { TenantPaymentWebhookReconcileService } from './tenant-payment-webhook-reconcile.service';
import { ReconcileWebhookEventDto } from './dto/reconcile-webhook-event.dto';
import { ReconcileChargePaymentDto } from './dto/reconcile-charge-payment.dto';
import { FiscalScopeBindingService } from './fiscal-scope-binding.service';
import { UpsertFiscalScopeBindingDto } from './dto/upsert-fiscal-scope-binding.dto';
import { CancelFiscalHandoffDto } from './dto/cancel-fiscal-handoff.dto';
import { FiscalReconciliationCancellationService } from './fiscal-reconciliation-cancellation.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StepUpGuard } from '../auth/guards/step-up.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { resolveTenantOperationGymId } from '../../common/security/tenant-operation-scope';

@Controller('financial')
@UseGuards(JwtAuthGuard, RolesGuard, StepUpGuard)
export class FinancialController {
  constructor(
    private financialService: FinancialService,
    private webhookInbox: StripePaymentWebhookInboxService,
    private tenantPaymentCheckout: TenantPaymentCheckoutService,
    private tenantPaymentReconciliation: TenantPaymentReconciliationService,
    private webhookReconciliation: TenantPaymentWebhookReconcileService,
    private fiscalScopeBinding: FiscalScopeBindingService,
    private fiscalLifecycle: FiscalReconciliationCancellationService,
  ) {}

  private resolveGymId(user: any, requestedGymId?: string) {
    return resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
  }

  @Post('accounts')
  @Roles('SUPER_ADMIN', 'OWNER')
  createAccount(@Body() dto: CreateFinancialAccountDto, @CurrentUser() user: any) {
    const gymId = this.resolveGymId(user, dto.gymId);
    return this.financialService.createAccount(dto, gymId, user.id);
  }

  @Get('accounts')
  @Roles('SUPER_ADMIN', 'OWNER')
  findAllAccounts(@CurrentUser() user: any, @Query('gymId') requestedGymId?: string) {
    return this.financialService.findAllAccounts(this.resolveGymId(user, requestedGymId));
  }

  @Post('subscriptions')
  @Roles('SUPER_ADMIN', 'OWNER')
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

  @Get('subscriptions')
  @Roles('SUPER_ADMIN', 'OWNER')
  findSubscriptions(
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
    @Query('studentId') studentId?: string,
    @Query('status') status?: string,
  ) {
    return this.financialService.findSubscriptions(
      this.resolveGymId(user, requestedGymId),
      { studentId, status },
    );
  }

  @Post('charges')
  @Roles('SUPER_ADMIN', 'OWNER')
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
  @Roles('SUPER_ADMIN', 'OWNER')
  findAllCharges(
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
    @Query('studentId') studentId?: string,
    @Query('status') status?: string,
    @Query('dueFrom') dueFrom?: string,
    @Query('dueTo') dueTo?: string,
    @Query('overdue') overdue?: string,
  ) {
    return this.financialService.findAllCharges(
      this.resolveGymId(user, requestedGymId),
      { studentId, status, dueFrom, dueTo, overdue },
    );
  }

  @Get('transactions')
  @Roles('SUPER_ADMIN', 'OWNER')
  findTransactions(
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
    @Query('studentId') studentId?: string,
    @Query('accountId') accountId?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.financialService.findTransactions(
      this.resolveGymId(user, requestedGymId),
      { studentId, accountId, status, type, from, to },
    );
  }

  @Post('gateway-events/:id/reconcile')
  @Roles('SUPER_ADMIN', 'OWNER')
  reconcileWebhookEvent(
    @Param('id') eventId: string,
    @Body() dto: ReconcileWebhookEventDto,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    return this.webhookReconciliation.processEvent(
      eventId, dto.accountId, this.resolveGymId(user, requestedGymId), user.id,
    );
  }

  @Get('gateway-events')
  @Roles('SUPER_ADMIN', 'OWNER')
  listGatewayEvents(
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    return this.webhookInbox.listForGym(this.resolveGymId(user, requestedGymId));
  }

  @Get('payment-providers')
  @Roles('SUPER_ADMIN', 'OWNER')
  listPaymentProviders(
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    return this.tenantPaymentCheckout.listAvailableProviders(
      this.resolveGymId(user, requestedGymId),
    );
  }

  @Post('charges/:id/reconcile-payment')
  @Roles('SUPER_ADMIN', 'OWNER')
  reconcileProviderPayment(
    @Param('id') id: string,
    @Body() dto: ReconcileChargePaymentDto,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    return this.tenantPaymentReconciliation.reconcile(
      id, dto.accountId, this.resolveGymId(user, requestedGymId), user.id,
    );
  }

  @Post('charges/:id/payment-session')
  @Roles('SUPER_ADMIN', 'OWNER')
  createPaymentSession(
    @Param('id') id: string,
    @Body() dto: CreateChargePaymentSessionDto,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    return this.tenantPaymentCheckout.createSession(
      id,
      dto,
      this.resolveGymId(user, requestedGymId),
      user.id,
    );
  }

  @Post('fiscal/scope-binding')
  @Roles('SUPER_ADMIN', 'OWNER')
  upsertFiscalScopeBinding(
    @Body() dto: UpsertFiscalScopeBindingDto,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    return this.fiscalScopeBinding.upsert(
      this.resolveGymId(user, requestedGymId),
      user.id,
      dto,
    );
  }

  @Get('fiscal/scope-binding')
  @Roles('SUPER_ADMIN', 'OWNER')
  getFiscalScopeBinding(
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    return this.fiscalScopeBinding.getSafe(
      this.resolveGymId(user, requestedGymId),
    );
  }

  @Get('fiscal/handoffs')
  @Roles('SUPER_ADMIN', 'OWNER')
  listFiscalHandoffs(
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
    @Query('status') status?: string,
  ) {
    return this.fiscalLifecycle.listTenantHandoffs(
      this.resolveGymId(user, requestedGymId),
      status,
    );
  }

  @Post('fiscal/handoffs/:id/cancel')
  @Roles('SUPER_ADMIN', 'OWNER')
  cancelFiscalHandoff(
    @Param('id') id: string,
    @Body() dto: CancelFiscalHandoffDto,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    return this.fiscalLifecycle.requestCancellation(
      id,
      this.resolveGymId(user, requestedGymId),
      user.id,
      dto,
    );
  }

  @Patch('charges/:id/pay')
  @Roles('SUPER_ADMIN', 'OWNER')
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
