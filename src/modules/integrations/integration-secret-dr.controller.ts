import {
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  IntegrationDrAssessDto,
  IntegrationDrReconcileDto,
} from './dto/integration-dr.dto';
import { IntegrationSecretDrService } from './integration-secret-dr.service';

@Controller('admin/integrations/dr')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class IntegrationSecretDrController {
  constructor(private readonly service: IntegrationSecretDrService) {}

  @Post('assess')
  assess(
    @CurrentUser() user: any,
    @Body() dto: IntegrationDrAssessDto,
  ) {
    return this.service.assess(user.id, dto);
  }

  @Post('reconcile-fail-closed')
  reconcile(
    @CurrentUser() user: any,
    @Body() dto: IntegrationDrReconcileDto,
  ) {
    return this.service.reconcileFailClosed(user.id, dto);
  }
}
