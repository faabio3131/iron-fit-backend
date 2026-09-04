import { Body, Controller, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AccessService } from './access.service';
import { CreateCredentialDto } from './dto/create-credential.dto';
import { ScanDto } from './dto/scan.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { resolveTenantOperationGymId } from '../../common/security/tenant-operation-scope';

@Controller('access')
export class AccessController {
  constructor(private accessService: AccessService) {}

  @Post('credentials')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  createCredential(
    @Body() dto: CreateCredentialDto,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.accessService.createCredential(dto, gymId, user.id);
  }

  @Post('devices/:deviceId/token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  provisionDeviceToken(
    @Param('deviceId') deviceId: string,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.accessService.provisionDeviceToken(deviceId, gymId, user.id);
  }

  @Post('scan')
  scan(@Body() dto: ScanDto) {
    return this.accessService.scan(dto);
  }
}
