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
import { FmCommandControlPlaneGuard } from './fm-command-control-plane.guard';
import { FmCommandControlPlaneService } from './fm-command-control-plane.service';

type FmCommandRequest = Request & { fmCommandCorrelationId?: string };

@Controller('control-plane/fmcc')
@UseGuards(FmCommandControlPlaneGuard)
export class FmCommandControlPlaneController {
  constructor(private readonly service: FmCommandControlPlaneService) {}

  @Get('health')
  health() {
    return this.service.health();
  }

  @Get('snapshot')
  snapshot() {
    return this.service.snapshot();
  }

  @Get('usage/ai')
  aiUsage(@Query('days') days?: string) {
    return this.service.aiUsage(days);
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
