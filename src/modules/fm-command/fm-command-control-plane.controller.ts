import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { FmCommandSubscriptionCommandDto } from './dto/fm-command-subscription-command.dto';
import { AiMonthlyQuotaService } from '../ai/runtime/ai-monthly-quota.service';
import { FmCommandControlPlaneGuard } from './fm-command-control-plane.guard';
import { FmCommandControlPlaneService } from './fm-command-control-plane.service';

type FmCommandRequest = Request & { fmCommandCorrelationId?: string };

@Controller('control-plane/fmcc')
@UseGuards(FmCommandControlPlaneGuard)
export class FmCommandControlPlaneController {
  constructor(
    private readonly service: FmCommandControlPlaneService,
    private readonly aiQuota: AiMonthlyQuotaService,
  ) {}

  @Get('health')
  health() {
    return this.service.health();
  }

  @Get('plan-versions')
  publishedPlanVersions() {
    return this.service.publishedPlanVersions();
  }

  @Get('snapshot')
  snapshot() {
    return this.service.snapshot();
  }

  @Get('usage/ai')
  aiUsage(@Query('days') days?: string) {
    return this.service.aiUsage(days);
  }

  // Only the guarded FM Command control plane may credit a verified PAID invoice.
  // A tenant browser cannot call these routes with its normal JWT.
  @Post('ai/credits/grant')
  grantAiCredits(@Body() body: {
    tenantId: string; sourceInvoiceId: string; packageCode: string; paymentStatus: string;
  }) {
    return this.aiQuota.grantPaidWorkoutPack(body);
  }

  @Post('ai/credits/revoke')
  revokeAiCredits(@Body() body: { tenantId: string; sourceInvoiceId: string }) {
    return this.aiQuota.revokePaidWorkoutPack(body);
  }

  @Post('subscription/commands')
  command(
    @Body() dto: FmCommandSubscriptionCommandDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: FmCommandRequest,
  ) {
    return this.service.executeSubscriptionCommand(
      dto,
      idempotencyKey ?? '',
      request.fmCommandCorrelationId ?? '',
    );
  }
}
