import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AccessService } from './access.service';
import { CreateCredentialDto } from './dto/create-credential.dto';
import { ConfigurePhysicalFirmwareDto, RegisterPhysicalDeviceDto, SetPhysicalDeviceActiveDto } from './dto/register-physical-device.dto';
import { PhysicalDeviceAdminService } from './hardware/physical-device-admin.service';
import { StepUpGuard } from '../auth/guards/step-up.guard';
import { ScanDto } from './dto/scan.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { resolveTenantOperationGymId } from '../../common/security/tenant-operation-scope';

@Controller('access')
export class AccessController {
  constructor(private accessService: AccessService, private physicalDevices: PhysicalDeviceAdminService) {}

  @Get('events')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  findRecentEvents(
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
    @Query('studentId') studentId?: string,
    @Query('deviceId') deviceId?: string,
    @Query('allowed') allowed?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.accessService.findRecentEvents(gymId, {
      studentId,
      deviceId,
      allowed,
      from,
      to,
    });
  }

  @Get('credentials')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  findCredentials(
    @CurrentUser() user: any,
    @Query('studentId') studentId?: string,
    @Query('active') active?: string,
    @Query('gymId') requestedGymId?: string,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.accessService.findCredentials(gymId, { studentId, active });
  }

  @Patch('credentials/:id/revoke')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  revokeCredential(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.accessService.revokeCredential(id, gymId, user.id);
  }

  @Get('devices')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  findDevices(
    @CurrentUser() user: any,
    @Query('active') active?: string,
    @Query('gymId') requestedGymId?: string,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.accessService.findDevices(gymId, { active });
  }

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

  @Post('devices')
  @UseGuards(JwtAuthGuard, RolesGuard, StepUpGuard)
  @Roles('SUPER_ADMIN', 'OWNER')
  registerPhysicalDevice(
    @CurrentUser() user: any,
    @Body() dto: RegisterPhysicalDeviceDto,
    @Query('gymId') requestedGymId?: string,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.physicalDevices.register(gymId, user.id, dto);
  }

  @Patch('devices/:deviceId/firmware')
  @UseGuards(JwtAuthGuard, RolesGuard, StepUpGuard)
  @Roles('SUPER_ADMIN', 'OWNER')
  configurePhysicalFirmware(
    @CurrentUser() user: any,
    @Param('deviceId') deviceId: string,
    @Body() dto: ConfigurePhysicalFirmwareDto,
    @Query('gymId') requestedGymId?: string,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.physicalDevices.configureFirmware(gymId, user.id, deviceId, dto);
  }

  @Patch('devices/:deviceId/active')
  @UseGuards(JwtAuthGuard, RolesGuard, StepUpGuard)
  @Roles('SUPER_ADMIN', 'OWNER')
  setPhysicalDeviceActive(
    @CurrentUser() user: any,
    @Param('deviceId') deviceId: string,
    @Body() dto: SetPhysicalDeviceActiveDto,
    @Query('gymId') requestedGymId?: string,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.physicalDevices.setActive(gymId, user.id, deviceId, dto.active);
  }

  @Post('devices/:deviceId/provision')
  @UseGuards(JwtAuthGuard, RolesGuard, StepUpGuard)
  @Roles('SUPER_ADMIN', 'OWNER')
  provisionInactivePhysicalDevice(
    @Param('deviceId') deviceId: string,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.accessService.provisionDeviceToken(deviceId, gymId, user.id, true);
  }

  @Post('scan')
  scan(@Body() dto: ScanDto) {
    return this.accessService.scan(dto);
  }
}
