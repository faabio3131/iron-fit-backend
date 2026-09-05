import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProductEntitlementsService } from './product-entitlements.service';
import { CreateProductPlanDto } from './dto/create-product-plan.dto';
import { CreateProductPlanVersionDto } from './dto/create-product-plan-version.dto';
import { SetProductPlanEntitlementDto } from './dto/set-product-plan-entitlement.dto';

@Controller('product-entitlements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductEntitlementsController {
  constructor(private readonly service: ProductEntitlementsService) {}

  @Get('plans')
  @Roles('SUPER_ADMIN')
  findPlans() {
    return this.service.findPlans();
  }

  @Post('plans')
  @Roles('SUPER_ADMIN')
  createPlan(@Body() dto: CreateProductPlanDto, @CurrentUser() user: any) {
    return this.service.createPlan(dto, user.id);
  }

  @Post('plans/:planId/versions')
  @Roles('SUPER_ADMIN')
  createVersion(
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Body() dto: CreateProductPlanVersionDto,
    @CurrentUser() user: any,
  ) {
    return this.service.createVersion(planId, dto, user.id);
  }

  @Put('plans/:planId/versions/:version/entitlements')
  @Roles('SUPER_ADMIN')
  setEntitlement(
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() dto: SetProductPlanEntitlementDto,
    @CurrentUser() user: any,
  ) {
    return this.service.setEntitlement(planId, version, dto, user.id);
  }

  @Post('plans/:planId/versions/:version/publish')
  @Roles('SUPER_ADMIN')
  publishVersion(
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Param('version', ParseIntPipe) version: number,
    @CurrentUser() user: any,
  ) {
    return this.service.publishVersion(planId, version, user.id);
  }

  @Post('plans/:planId/versions/:version/retire')
  @Roles('SUPER_ADMIN')
  retireVersion(
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Param('version', ParseIntPipe) version: number,
    @CurrentUser() user: any,
  ) {
    return this.service.retireVersion(planId, version, user.id);
  }
}
