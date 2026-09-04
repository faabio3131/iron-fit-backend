import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { GymsService } from './gyms.service';
import { CreateGymDto } from './dto/create-gym.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('gyms')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GymsController {
  constructor(private gymsService: GymsService) {}

  @Post()
  @Roles('SUPER_ADMIN')
  create(@Body() dto: CreateGymDto, @CurrentUser() user: any) {
    return this.gymsService.create(dto, user.id);
  }

  @Get()
  @Roles('SUPER_ADMIN')
  findAll() {
    return this.gymsService.findAll();
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.gymsService.findOne(
      id,
      user.activeGymId ?? user.gymId,
      user.isSuperAdmin === true,
    );
  }
}
