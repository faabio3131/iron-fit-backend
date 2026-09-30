import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  BillingWebhookDto,
  CancelSaasBillingDto,
  ChangeSaasPlanDto,
  CreateSaasCheckoutDto,
  CreateSaasPriceDto,
  RefundSaasBillingDto,
  RunSaasBillingDto,
} from './dto/saas-billing.dto';
import { SaasBillingService } from './saas-billing.service';

@Controller('saas-billing')
export class SaasBillingController {
  constructor(private readonly service: SaasBillingService) {}

  @Get('prices')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  listPrices() {
    return this.service.listPrices();
  }

  @Post('prices')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  createPrice(@Body() dto: CreateSaasPriceDto, @CurrentUser() user: any) {
    return this.service.createPrice(dto, user?.id);
  }

  @Get('current')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  current(@CurrentUser() user: any) {
    return this.service.getCurrent(user?.activeGymId ?? user?.gymId);
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  checkout(
    @Body() dto: CreateSaasCheckoutDto,
    @CurrentUser() user: any,
  ) {
    return this.service.createCheckout(
      user?.activeGymId ?? user?.gymId,
      user?.id,
      dto,
    );
  }

  @Post('change-plan')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  changePlan(
    @Body() dto: ChangeSaasPlanDto,
    @CurrentUser() user: any,
  ) {
    return this.service.changePlan(
      user?.activeGymId ?? user?.gymId,
      user?.id,
      dto,
    );
  }

  @Post('cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  cancel(
    @Body() dto: CancelSaasBillingDto,
    @CurrentUser() user: any,
  ) {
    return this.service.cancel(
      user?.activeGymId ?? user?.gymId,
      user?.id,
      dto,
    );
  }

  @Post('refunds')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  refund(@Body() dto: RefundSaasBillingDto, @CurrentUser() user: any) {
    return this.service.refund(dto, user?.id);
  }

  @Post('admin/recurrence/run')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  runRecurrence(@Body() dto: RunSaasBillingDto, @CurrentUser() user: any) {
    return this.service.runRecurrence(dto, user?.id);
  }

  @Post('admin/dunning/run')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  runDunning(@Body() dto: RunSaasBillingDto, @CurrentUser() user: any) {
    return this.service.runDunning(dto, user?.id);
  }

  @Post('admin/reconcile')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  reconcile(@CurrentUser() user: any) {
    return this.service.reconcile(user?.id);
  }

  @Post('webhooks/:providerCode')
  webhook(
    @Param('providerCode') providerCode: string,
    @Headers('x-saas-billing-signature') signature: string | undefined,
    @Body() dto: BillingWebhookDto,
  ) {
    return this.service.processWebhook(providerCode, signature, dto);
  }
}
