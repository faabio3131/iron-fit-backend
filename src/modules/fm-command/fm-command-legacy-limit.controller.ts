import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { TenantProductEntitlementsService } from '../product-entitlements/tenant-product-entitlements.service';
import { FmCommandPlanGovernanceGuard } from './fm-command-plan-governance.guard';
import { AlignFmLegacyLimitDto } from './dto/align-fm-legacy-limit.dto';

@Controller('control-plane/fmcc/legacy-limits')
@UseGuards(FmCommandPlanGovernanceGuard)
export class FmCommandLegacyLimitController {
  constructor(private readonly service: TenantProductEntitlementsService) {}

  @Get(':gymId')
  async preview(@Param('gymId', new ParseUUIDPipe()) gymId: string) {
    return {
      schema_version: 'iron.fmcc.legacy-limits.v1',
      product_code: 'IRON_FIT_CORE',
      gymId,
      limits: await this.service.previewFmLegacyLimits(gymId),
    };
  }

  @Post(':gymId/:featureKey/align')
  async align(
    @Param('gymId', new ParseUUIDPipe()) gymId: string,
    @Param('featureKey') featureKey: string,
    @Body() body: AlignFmLegacyLimitDto,
    @Req() request: { fmCommandCorrelationId: string },
  ) {
    return this.service.alignFmLegacyLimit(gymId, featureKey, body, request.fmCommandCorrelationId);
  }
}
