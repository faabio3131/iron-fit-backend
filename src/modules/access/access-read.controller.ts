import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { resolveTenantOperationGymId } from '../../common/security/tenant-operation-scope';
import { AccessReadService } from './access-read.service';

@Controller('access')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AccessReadController {
  constructor(private readonly accessReadService: AccessReadService) {}

  @Get('events')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  findRecentEvents(
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
    @Query('limit') requestedLimit?: string,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    const parsed = requestedLimit ? Number.parseInt(requestedLimit, 10) : 100;
    return this.accessReadService.findRecentEvents(gymId, parsed);
  }
}
