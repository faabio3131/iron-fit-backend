import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AccessService } from './access.service';
import { CreateCredentialDto } from './dto/create-credential.dto';
import { ScanDto } from './dto/scan.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('access')
export class AccessController {
  constructor(private accessService: AccessService) {}

  @Post('credentials')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  createCredential(@Body() dto: CreateCredentialDto, @CurrentUser() user: any) {
    return this.accessService.createCredential(dto, user.gymId);
  }

  @Post('scan')
  scan(@Body() dto: ScanDto) {
    return this.accessService.scan(dto.qrToken, dto.deviceId);
  }
}
