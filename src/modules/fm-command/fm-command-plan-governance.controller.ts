import {
  Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe,
  Post, Put, UseGuards, ServiceUnavailableException,
} from '@nestjs/common';
import { ProductEntitlementsService } from '../product-entitlements/product-entitlements.service';
import { ProductCapabilityCatalogService } from '../product-entitlements/product-capability-catalog.service';
import { CreateProductPlanDto } from '../product-entitlements/dto/create-product-plan.dto';
import { CreateProductPlanVersionDto } from '../product-entitlements/dto/create-product-plan-version.dto';
import { SetProductPlanEntitlementDto } from '../product-entitlements/dto/set-product-plan-entitlement.dto';
import { FmCommandPlanGovernanceGuard } from './fm-command-plan-governance.guard';

/** This is not the browser product-entitlements API. The separate S2S guard
 * and dedicated token only allow FM's governed server to invoke the existing
 * IRON canonical plan engine. No gymId or entitlement overrides are accepted.
 */
@Controller('control-plane/fmcc/plan-governance')
@UseGuards(FmCommandPlanGovernanceGuard)
export class FmCommandPlanGovernanceController {
  constructor(
    private readonly plans: ProductEntitlementsService,
    private readonly capabilities: ProductCapabilityCatalogService,
  ) {}

  @Get('catalog')
  async catalog() {
    const [plans, capabilities] = await Promise.all([
      this.plans.findPlans(),
      this.capabilities.listGovernance(),
    ]);
    if (plans.length > 256 || capabilities.length > 512 ||
      plans.some((plan) => plan.versions.length > 64)) {
      throw new ServiceUnavailableException('Catalogo de planos excede limite de leitura');
    }
    return {
      schema_version: 'iron.fmcc.plan-governance.v1',
      product_code: 'IRON_FIT_CORE',
      plans: plans.map((plan) => ({
        id: plan.id, code: plan.code, name: plan.name,
        versions: plan.versions.map((version) => ({
          version: version.version, status: version.status,
          entitlements: version.entitlements.map((item) => ({
            featureKey: item.featureKey, kind: item.kind,
            featureEnabled: item.featureEnabled, limitValue: item.limitValue,
            policyValues: item.policyValues,
          })),
        })),
      })),
      capabilities: capabilities.map((item) => ({
        key: item.key, kind: item.kind, domain: item.domain,
        description: item.description, status: item.status,
        allowedPolicyValues: item.allowedPolicyValues,
      })),
    };
  }

  @Post('plans')
  createPlan(@Body() body: CreateProductPlanDto) {
    return this.plans.createPlan(body);
  }

  @Post('plans/:planId/versions')
  createVersion(
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Body() body: CreateProductPlanVersionDto,
  ) {
    return this.plans.createVersion(planId, body);
  }

  @Put('plans/:planId/versions/:version/entitlements')
  setEntitlement(
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() body: SetProductPlanEntitlementDto,
  ) {
    return this.plans.setEntitlement(planId, version, body);
  }

  @Post('plans/:planId/versions/:version/publish')
  publishVersion(
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.plans.publishVersion(planId, version);
  }
}
