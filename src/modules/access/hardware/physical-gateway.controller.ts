import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { resolveTenantOperationGymId } from '../../../common/security/tenant-operation-scope';
import { PhysicalAccessRecoveryService } from './physical-access-recovery.service';
import {
  GatewayAckDto, GatewayClaimDto, GatewayIdentifyDto, GatewayPassageDto,
} from '../dto/physical-gateway.dto';
import { PhysicalGatewayService } from './physical-gateway.service';

/**
 * Device-token authenticated public edge for on-premise SDK connectors.
 * No JWT user session is accepted as a substitute for device authentication.
 * No tenant is accepted in requests; all scope derives from device binding.
 */
@Controller('access/hardware')
export class PhysicalGatewayController {
  constructor(private readonly gateway: PhysicalGatewayService, private readonly recovery: PhysicalAccessRecoveryService) {}

  @Get('attempts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  listAttempts(
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.recovery.listRecent(gymId);
  }

  @Post('identify')
  identify(@Body() dto: GatewayIdentifyDto) {
    return this.gateway.identify(dto);
  }

  @Post('claim')
  claim(@Body() dto: GatewayClaimDto) {
    return this.gateway.claim(dto);
  }

  @Post('ack')
  ack(@Body() dto: GatewayAckDto) {
    return this.gateway.ack(dto);
  }

  @Post('passage')
  passage(@Body() dto: GatewayPassageDto) {
    return this.gateway.passage(dto);
  }
}
