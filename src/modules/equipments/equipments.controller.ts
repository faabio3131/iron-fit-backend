import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { EquipmentsService } from './equipments.service';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('equipments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EquipmentsController {
  constructor(private equipmentsService: EquipmentsService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER')
  create(@Body() dto: CreateEquipmentDto, @CurrentUser() user: any) {
    return this.equipmentsService.create(dto, user.gymId);
  }

  @Get()
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER', 'RECEPTION')
  findAll(@CurrentUser() user: any) {
    return this.equipmentsService.findAll(user.gymId);
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER', 'RECEPTION')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.equipmentsService.findOne(id, user.gymId);
  }
}
