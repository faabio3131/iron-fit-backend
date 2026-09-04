import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CommunicationService } from './communication.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { resolveTenantOperationGymId } from '../../common/security/tenant-operation-scope';

@Controller('communication')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CommunicationController {
  constructor(private communicationService: CommunicationService) {}

  @Post('templates')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  createTemplate(@Body() dto: CreateTemplateDto, @CurrentUser() user: any) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId: dto.gymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.communicationService.createTemplate(dto, gymId);
  }

  @Get('templates')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  findAllTemplates(@CurrentUser() user: any, @Query('gymId') requestedGymId?: string) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.communicationService.findAllTemplates(gymId);
  }

  @Post('messages')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  sendMessage(
    @Body() dto: SendMessageDto,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.communicationService.sendMessage(dto, gymId);
  }

  @Get('messages')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  findAllMessages(@CurrentUser() user: any, @Query('gymId') requestedGymId?: string) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.communicationService.findAllMessages(gymId);
  }

  @Post('automations')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  createAutomation(@Body() dto: CreateAutomationDto, @CurrentUser() user: any) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId: dto.gymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.communicationService.createAutomation(dto, gymId);
  }

  @Get('automations')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  findAllAutomations(@CurrentUser() user: any, @Query('gymId') requestedGymId?: string) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.communicationService.findAllAutomations(gymId);
  }
}
