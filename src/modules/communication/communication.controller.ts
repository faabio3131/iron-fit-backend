import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { CommunicationService } from './communication.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('communication')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CommunicationController {
  constructor(private communicationService: CommunicationService) {}

  @Post('templates')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  createTemplate(@Body() dto: CreateTemplateDto, @CurrentUser() user: any) {
    return this.communicationService.createTemplate(dto, user.gymId);
  }

  @Get('templates')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  findAllTemplates(@CurrentUser() user: any) {
    return this.communicationService.findAllTemplates(user.gymId);
  }

  @Post('messages')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  sendMessage(@Body() dto: SendMessageDto, @CurrentUser() user: any) {
    return this.communicationService.sendMessage(dto, user.gymId);
  }

  @Get('messages')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  findAllMessages(@CurrentUser() user: any) {
    return this.communicationService.findAllMessages(user.gymId);
  }

  @Post('automations')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  createAutomation(@Body() dto: CreateAutomationDto, @CurrentUser() user: any) {
    return this.communicationService.createAutomation(dto, user.gymId);
  }

  @Get('automations')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  findAllAutomations(@CurrentUser() user: any) {
    return this.communicationService.findAllAutomations(user.gymId);
  }
}
