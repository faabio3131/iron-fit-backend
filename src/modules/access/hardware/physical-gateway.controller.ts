import { Body, Controller, Post } from '@nestjs/common';
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
  constructor(private readonly gateway: PhysicalGatewayService) {}

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
