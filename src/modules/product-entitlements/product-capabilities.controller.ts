import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateProductCapabilityDto } from './dto/create-product-capability.dto';
import { ProductCapabilityCatalogService } from './product-capability-catalog.service';

@Controller('product-capabilities')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class ProductCapabilitiesController {
  constructor(private readonly service: ProductCapabilityCatalogService) {}

  @Get()
  list() {
    return this.service.listGovernance();
  }

  @Post()
  create(@Body() dto: CreateProductCapabilityDto, @CurrentUser() user: any) {
    return this.service.create(dto, user.id);
  }

  @Post(':featureKey/retire')
  retire(@Param('featureKey') featureKey: string, @CurrentUser() user: any) {
    return this.service.retire(featureKey, user.id);
  }
}
